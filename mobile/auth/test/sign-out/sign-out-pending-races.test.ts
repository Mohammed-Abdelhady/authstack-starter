import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import { readStoredValue } from '../../src/storage/envelope';
import { createAuthEngine } from '../support/engine';
import { queuedWorkDone } from '../support/queued-work';
import { revokedTokens } from '../support/tracking';
import { REFRESH_2_TOKEN, REFRESH_NEXT_TOKEN } from '../support/token-values';
import {
  CONFIG,
  Deferred,
  REFRESH_TOKEN,
  ScriptedTransport,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../support/support';

const FIRST_RETRY_DELAY_MS = 30_000;
type Reply = { status: number; body: unknown };

function pendingTokens(value: string | undefined): string[] {
  const read = readStoredValue(value ?? '');
  return read.kind === 'read' ? read.pending.map((entry) => entry.refreshToken) : [];
}

function sessionToken(value: string | undefined): string | undefined {
  const read = readStoredValue(value ?? '');
  return read.kind === 'read' ? read.session?.tokens?.refreshToken : undefined;
}

/** Session A signed out offline, so A waits; then session B signed in beside it. */
async function waitingBesideSession() {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const engine = createAuthEngine(CONFIG, ports);
  await establishSession(engine, ports, transport);
  transport.enqueue(new Error('offline'));
  await engine.signOut();
  await establishSession(engine, ports, transport, 'access-2', REFRESH_2_TOKEN);
  return { transport, ports, engine };
}

/** A second engine on a copy of what the device held, before it restored anything. */
function freshEngineOn(ports: ReturnType<typeof testPorts>) {
  const transport = new ScriptedTransport();
  const next = testPorts(transport);
  next.credentials.value = ports.credentials.value;
  next.install = ports.install;
  next.clock.wall = ports.clock.wall;
  return { transport, ports: next, engine: createAuthEngine(CONFIG, next) };
}

describe('sign-out and retries that overlap', () => {
  // W1: a retry's change runs against the latest committed list, inside the queue.
  it('keeps a newer sign-out pending when a retry ends after its write was queued', async () => {
    const { transport, ports, engine } = await waitingBesideSession();
    ports.clock.advance(FIRST_RETRY_DELAY_MS);
    const retrySent = new Deferred<void>();
    const retryAnswer = new Deferred<Reply>();
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/revoke') retrySent.resolve();
    };
    transport.enqueue(() => retryAnswer.promise, new Error('offline'));
    const foreground = engine.restore();
    await retrySent.promise;
    const intentStarted = new Deferred<void>();
    const finishIntent = new Deferred<void>();
    ports.credentials.beforeReplace = () => {
      intentStarted.resolve();
      return finishIntent.promise;
    };

    const signOut = engine.signOut();
    await intentStarted.promise;
    retryAnswer.resolve({ status: 200, body: {} });
    await queuedWorkDone();
    ports.credentials.beforeReplace = undefined;
    finishIntent.resolve();
    await Promise.all([foreground, signOut]);

    expect(pendingTokens(ports.credentials.value)).toEqual([REFRESH_2_TOKEN]);
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN, REFRESH_TOKEN, REFRESH_2_TOKEN]);
  });

  // W2: a fresh engine keeps what already waits when it signs out a stored session.
  it('adds the stored session to what already waits on a fresh engine', async () => {
    const { ports } = await waitingBesideSession();
    const fresh = freshEngineOn(ports);
    fresh.transport.enqueue(new Error('offline'));

    await expect(fresh.engine.signOut()).resolves.toMatchObject({
      kind: 'signedOut',
      revocation: 'failed',
    });

    expect(pendingTokens(fresh.ports.credentials.value)).toEqual([REFRESH_TOKEN, REFRESH_2_TOKEN]);
    expect(sessionToken(fresh.ports.credentials.value)).toBeUndefined();
  });

  it('keeps a value that only waits when a fresh engine signs out with no session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue(new Error('offline'));
    await engine.signOut();
    const waiting = ports.credentials.value;
    const fresh = freshEngineOn(ports);

    await expect(fresh.engine.signOut()).resolves.toEqual({
      kind: 'signedOut',
      revocation: 'notNeeded',
    });

    expect(fresh.ports.credentials.value).toBe(waiting);
    expect(fresh.transport.sent).toEqual([]);
  });

  // W7: a sign-out with no session of its own still tries what is due.
  it('revokes a due waiting token when signing out with no session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue(new Error('offline'));
    await engine.signOut();
    await engine.restore();
    ports.clock.advance(FIRST_RETRY_DELAY_MS);
    transport.enqueue({ status: 200, body: {} });

    await expect(engine.signOut()).resolves.toEqual({ kind: 'signedOut', revocation: 'revoked' });

    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN, REFRESH_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
  });

  // W6: a refresh in flight has spent the token held here, so it is never put back.
  it('ends the session here when a sign-out during a refresh cannot be saved', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const refreshSent = new Deferred<void>();
    const refreshAnswer = new Deferred<Reply>();
    const rotatedRevoked = new Deferred<void>();
    transport.respond = async ({ path }) => {
      if (path === '/api/oauth/token') {
        refreshSent.resolve();
        return refreshAnswer.promise;
      }
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      throw new Error(`Unexpected request: ${path}`);
    };
    transport.onResponse = ({ path }) => {
      if (path === '/api/oauth/revoke' && revokedTokens(transport).includes(REFRESH_NEXT_TOKEN))
        rotatedRevoked.resolve();
    };
    const request = engine.transport
      .request({ method: HTTP_METHOD.GET, path: '/api/user/profile' })
      .then(
        () => undefined,
        () => undefined,
      );
    await refreshSent.promise;
    ports.credentials.beforeReplace = (value) =>
      value.includes('"pendingRevocations"')
        ? Promise.reject(new Error('keychain busy'))
        : Promise.resolve();

    const outcome = await engine.signOut();
    refreshAnswer.resolve(oauthTokenReply('access-next', REFRESH_NEXT_TOKEN));
    await request;
    await rotatedRevoked.promise;

    expect(outcome).toMatchObject({ kind: 'signedOut', revocation: 'revoked' });
    expect(outcome.error?.message).toBe('keychain busy');
    expect(engine.snapshot).toMatchObject({
      status: 'signedOut',
      operation: 'none',
      warning: 'storageBlocked',
    });
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN, REFRESH_NEXT_TOKEN]);
    await expect(engine.refresh()).resolves.toEqual({ kind: 'notSignedIn' });
    await expect(engine.restore()).resolves.toEqual({ kind: 'restored', status: 'signedOut' });
    expect(sessionToken(ports.credentials.value)).toBeUndefined();
  });
});

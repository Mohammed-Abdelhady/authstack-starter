import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import { CREDENTIAL_WRITE_TIMEOUT_MS, SIGN_OUT_REVOKE_TIMEOUT_MS } from '../../src/constants';
import { readStoredValue } from '../../src/storage/envelope';
import { createAuthEngine } from '../support/engine';
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

function storedRead(value: string | undefined) {
  return readStoredValue(value ?? '');
}

/** A second engine on a copy of what the device held, as after a restart. */
function restartedFrom(ports: ReturnType<typeof testPorts>) {
  const transport = new ScriptedTransport();
  const next = testPorts(transport);
  next.credentials.value = ports.credentials.value;
  next.install = ports.install;
  next.clock.wall = ports.clock.wall;
  const slotCleared = new Deferred<void>();
  next.credentials.afterDelete = () => slotCleared.resolve();
  return { transport, ports: next, engine: createAuthEngine(CONFIG, next), slotCleared };
}

describe('sign-out that waits on the server', () => {
  // Cases 35 and 38: one replace holds the intent; a restart before the answer still revokes.
  it('saves the intent in one replace, and the next start is signed out and revokes', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const revokeSent = new Deferred<void>();
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/revoke') revokeSent.resolve();
    };
    transport.enqueue(() => new Promise(() => undefined));
    const eventsBefore = ports.credentials.events.length;

    const signOut = engine.signOut();
    await revokeSent.promise;

    expect(ports.credentials.events.slice(eventsBefore)).toEqual(['replace:start', 'replace:done']);
    expect(engine.snapshot.status).toBe('signedOut');
    // The attempt in flight was reserved in the same write, with its next due time.
    expect(storedRead(ports.credentials.value)).toMatchObject({
      kind: 'read',
      session: undefined,
      pending: [
        {
          refreshToken: REFRESH_TOKEN,
          attempts: 1,
          nextAttemptAt: ports.clock.wall + FIRST_RETRY_DELAY_MS,
        },
      ],
    });
    const restarted = restartedFrom(ports);
    restarted.ports.clock.advance(FIRST_RETRY_DELAY_MS);
    ports.timer.fireDelay(SIGN_OUT_REVOKE_TIMEOUT_MS);
    await expect(signOut).resolves.toMatchObject({ kind: 'signedOut', revocation: 'timedOut' });
    restarted.transport.enqueue({ status: 200, body: {} });

    await expect(restarted.engine.restore()).resolves.toEqual({
      kind: 'restored',
      status: 'signedOut',
    });
    await restarted.slotCleared.promise;

    expect(revokedTokens(restarted.transport)).toEqual([REFRESH_TOKEN]);
    expect(restarted.ports.credentials.value).toBeUndefined();
  });

  // Case 42, late: the write reported as not saved lands after all, so the device says signed out.
  it('finishes a sign-out whose write lands after it was reported as not saved', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const writeStarted = new Deferred<void>();
    const finishWrite = new Deferred<void>();
    ports.credentials.beforeReplace = () => {
      writeStarted.resolve();
      return finishWrite.promise;
    };
    transport.enqueue({ status: 200, body: {} });

    const signOut = engine.signOut();
    await writeStarted.promise;
    ports.timer.fireDelay(CREDENTIAL_WRITE_TIMEOUT_MS);
    await expect(signOut).resolves.toMatchObject({ kind: 'signOutNotSaved' });
    expect(engine.snapshot.status).toBe('signedIn');
    const slotCleared = new Deferred<void>();
    ports.credentials.afterDelete = () => slotCleared.resolve();
    finishWrite.resolve();
    await slotCleared.promise;

    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.credentials.value).toBeUndefined();
  });

  // Case 36: what waits to be revoked never signs anyone in or refreshes.
  it('restores a waiting revocation as signed out and never refreshes with it', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue(new Error('offline'));
    await engine.signOut();
    const restarted = restartedFrom(ports);

    await expect(restarted.engine.restore()).resolves.toEqual({
      kind: 'restored',
      status: 'signedOut',
    });
    await expect(restarted.engine.refresh()).resolves.toEqual({ kind: 'notSignedIn' });
    await expect(
      restarted.engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toThrow();

    expect(restarted.transport.sent).toEqual([]);
    expect(restarted.ports.credentials.value).toBe(ports.credentials.value);
  });

  // Case 39: a refresh answered after sign-out began never stores its token.
  it('does not store the token of a refresh that finishes after sign-out began', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const refreshSent = new Deferred<void>();
    const refreshAnswer = new Deferred<{ status: number; body: unknown }>();
    const lateTokenRevoked = new Deferred<void>();
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
        lateTokenRevoked.resolve();
    };
    const writes: string[] = [];
    ports.credentials.afterReplace = (value) => writes.push(value);
    const request = engine.transport
      .request({ method: HTTP_METHOD.GET, path: '/api/user/profile' })
      .then(
        () => undefined,
        () => undefined,
      );
    await refreshSent.promise;

    await expect(engine.signOut()).resolves.toEqual({ kind: 'signedOut', revocation: 'revoked' });
    refreshAnswer.resolve(oauthTokenReply('access-next', REFRESH_NEXT_TOKEN));
    await request;
    await lateTokenRevoked.promise;

    expect(writes.filter((value) => value.includes(REFRESH_NEXT_TOKEN))).toEqual([]);
    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
  });

  // Case 40, and the migration: two offline sign-outs both wait, one per lineage.
  it('keeps one revocation per session signed out offline and revokes both later', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue(new Error('offline'));
    await engine.signOut();
    await establishSession(engine, ports, transport, 'access-2', REFRESH_2_TOKEN);

    const signedInAgain = storedRead(ports.credentials.value);
    expect(signedInAgain).toMatchObject({
      kind: 'read',
      session: { tokens: { refreshToken: REFRESH_2_TOKEN } },
      pending: [{ refreshToken: REFRESH_TOKEN }],
    });
    transport.enqueue(new Error('offline'));
    await engine.signOut();
    const waiting = storedRead(ports.credentials.value);
    expect(waiting).toMatchObject({
      kind: 'read',
      session: undefined,
      pending: [{ refreshToken: REFRESH_TOKEN }, { refreshToken: REFRESH_2_TOKEN }],
    });
    const lineages = waiting.kind === 'read' ? waiting.pending.map((entry) => entry.lineageId) : [];
    expect(new Set(lineages).size).toBe(2);

    ports.clock.advance(FIRST_RETRY_DELAY_MS);
    const slotCleared = new Deferred<void>();
    ports.credentials.afterDelete = () => slotCleared.resolve();
    transport.enqueue({ status: 200, body: {} }, { status: 200, body: {} });
    await engine.restore();
    await slotCleared.promise;

    expect(revokedTokens(transport)).toEqual([
      REFRESH_TOKEN,
      REFRESH_2_TOKEN,
      REFRESH_TOKEN,
      REFRESH_2_TOKEN,
    ]);
    expect(ports.credentials.value).toBeUndefined();
  });
});

import {
  REFRESH_ROTATED_TOKEN,
  REFRESH_BEFORE_REFRESH_TOKEN,
  REFRESH_AFTER_REFRESH_TOKEN,
} from '../support/token-values';
import { HTTP_METHOD, createApiClient } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { CredentialStoreError } from '../../src';
import { persistRotatedSessionAfterDispose } from '../../src/refresh/refresh-dispose';
import { makeRefreshRecord } from '../../src/refresh/refresh-helpers';
import { AuthRuntime } from '../../src/runtime/runtime';
import type { RuntimeTokens } from '../../src/types/record';
import { refreshRequests } from '../support/device-bound-support';
import { createAuthEngine } from '../support/engine';
import { revokedTokens } from '../support/tracking';
import {
  REFRESH_TOKEN,
  CONFIG,
  type CredentialWrite,
  ScriptedTransport,
  apiReply,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../support/support';

const PROFILE = { method: HTTP_METHOD.GET, path: '/api/user/profile' } as const;
const ACCESS_TOKEN_LIFETIME_MS = 270_000;

/** A signed-in engine whose refresh rotated the token while the store refused to save it. */
async function rotatedWhileRefused(refusal: CredentialWrite) {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const engine = createAuthEngine(CONFIG, ports);
  await establishSession(engine, ports, transport);
  ports.clock.advance(ACCESS_TOKEN_LIFETIME_MS);
  transport.enqueue(oauthTokenReply('access-rotated', REFRESH_ROTATED_TOKEN), apiReply({}));
  // The marker before the refresh is saved. The rotated record after it is refused.
  ports.credentials.beforeReplace = async (value) =>
    value.includes('"refreshInFlight":true') ? undefined : refusal;
  await engine.transport.request(PROFILE);
  return { transport, ports, engine };
}

function storedRecord(value: string | undefined): unknown {
  return value === undefined ? undefined : JSON.parse(value);
}

describe('a write the store refused', () => {
  it('ends a sign-in as a storage failure that carries the reason', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    ports.credentials.writeResult = { kind: 'locked' };

    const outcome = await engine.signIn();

    expect(outcome.kind).toBe('storageFailure');
    expect(outcome).toMatchObject({
      error: {
        name: 'CredentialStoreError',
        operation: 'credentials.replace',
        condition: 'locked',
      },
    });
    expect('error' in outcome && outcome.error instanceof CredentialStoreError).toBe(true);
    expect(engine.snapshot).toEqual({
      status: 'storageBlocked',
      operation: 'none',
      reason: 'storageFailure',
    });
    expect(ports.authBrowser.opened).toHaveLength(0);
    expect(ports.credentials.value).toBeUndefined();
  });
});

describe('a rotated token the locked store refused', () => {
  it('stays signed in on the new token and says the store is locked', async () => {
    const { transport, ports, engine } = await rotatedWhileRefused({ kind: 'locked' });

    expect(engine.snapshot).toMatchObject({
      status: 'signedIn',
      operation: 'none',
      warning: 'storageBlocked',
      reason: 'storageLocked',
    });
    expect(transport.sent.at(-1)?.headers?.['Authorization']).toBe('Bearer access-rotated');
    expect(storedRecord(ports.credentials.value)).toMatchObject({
      tokens: { refreshToken: REFRESH_TOKEN },
      refreshInFlight: true,
    });
  });

  it('saves it on the next restore once the store is unlocked, without a second refresh', async () => {
    const { transport, ports, engine } = await rotatedWhileRefused({ kind: 'locked' });
    ports.credentials.beforeReplace = undefined;

    const outcome = await engine.restore();

    expect(outcome).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(storedRecord(ports.credentials.value)).toMatchObject({
      tokens: { refreshToken: REFRESH_ROTATED_TOKEN },
    });
    expect(ports.credentials.value).not.toContain('refreshInFlight');
    expect(engine.snapshot.warning).toBeUndefined();
    expect(engine.snapshot.reason).toBeUndefined();
    expect(refreshRequests(transport)).toHaveLength(1);
  });

  it('keeps the warning when restore finds the store still locked', async () => {
    const { transport, ports, engine } = await rotatedWhileRefused({ kind: 'locked' });

    const outcome = await engine.restore();

    expect(outcome).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(engine.snapshot).toMatchObject({
      status: 'signedIn',
      operation: 'none',
      warning: 'storageBlocked',
      reason: 'storageLocked',
    });
    expect(storedRecord(ports.credentials.value)).toMatchObject({
      tokens: { refreshToken: REFRESH_TOKEN },
      refreshInFlight: true,
    });
    expect(refreshRequests(transport)).toHaveLength(1);
  });

  it('does not write on restore when the store was unavailable, not locked', async () => {
    const { ports, engine } = await rotatedWhileRefused({ kind: 'unavailable' });
    ports.credentials.beforeReplace = undefined;
    const eventsBefore = ports.credentials.events.length;

    expect(engine.snapshot.warning).toBe('storageBlocked');
    expect(engine.snapshot.reason).toBeUndefined();

    const outcome = await engine.restore();

    expect(outcome).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(ports.credentials.events.slice(eventsBefore)).toEqual([]);
    expect(engine.snapshot.warning).toBe('storageBlocked');
  });
});

describe('a late rotated token after dispose, with the store locked', () => {
  it('revokes the token it could not save and leaves the stored record as it was', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const runtime = new AuthRuntime(CONFIG, ports);
    const previous: RuntimeTokens = {
      accessToken: 'access-before-refresh',
      refreshToken: REFRESH_BEFORE_REFRESH_TOKEN,
      expiresAt: 0,
      version: 1,
      lineageId: 'locked-write-lineage',
    };
    runtime.installDigest = 'install-digest';
    runtime.tokens = previous;
    runtime.record = makeRefreshRecord(runtime, 'install-digest', previous, true);
    const marker = JSON.stringify(runtime.record);
    ports.credentials.value = marker;
    runtime.setState('signedIn', 'refreshing');
    runtime.dispose();
    ports.credentials.writeResult = { kind: 'locked' };
    transport.enqueue({ status: 200, body: {} });

    await persistRotatedSessionAfterDispose(
      runtime,
      createApiClient(transport),
      'install-digest',
      REFRESH_BEFORE_REFRESH_TOKEN,
      {
        accessToken: 'access-after-refresh',
        refreshToken: REFRESH_AFTER_REFRESH_TOKEN,
        lineageId: 'locked-write-lineage',
      },
    );

    expect(revokedTokens(transport)).toEqual([REFRESH_AFTER_REFRESH_TOKEN]);
    expect(ports.credentials.value).toBe(marker);
    expect(ports.timer.pending).toBe(0);
  });
});

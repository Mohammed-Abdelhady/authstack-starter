import { describe, expect, it } from 'vitest';
import { HTTP_METHOD, OAuthError, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import { allowRefreshReplayAfterSharedStoreRace } from '../support/tracking';
import {
  ACCESS_TOKEN,
  CONFIG,
  REFRESH_TOKEN,
  ScriptedTransport,
  apiReply,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../support/support';

describe('restore with live or owed session state', () => {
  it('finishes restore and can sign in after deleting a session owed before restore', async () => {
    const originalTransport = new ScriptedTransport();
    const originalPorts = testPorts(originalTransport);
    const original = createAuthEngine(CONFIG, originalPorts);
    await establishSession(original, originalPorts, originalTransport);

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials = originalPorts.credentials;
    ports.install = originalPorts.install;
    let rejectFirstDelete = true;
    ports.credentials.beforeDelete = () => {
      if (rejectFirstDelete) {
        rejectFirstDelete = false;
        return Promise.reject(new Error('keychain unavailable'));
      }
      return Promise.resolve();
    };
    transport.enqueue({ status: 200, body: {} });
    const engine = createAuthEngine(CONFIG, ports);

    await expect(engine.signOut()).resolves.toMatchObject({
      kind: 'signedOut',
      revocation: 'revoked',
    });
    ports.credentials.beforeDelete = undefined;
    ports.authBrowser.results.push(() => ({ kind: 'cancelled' }));

    await expect(engine.restore()).resolves.toEqual({
      kind: 'restored',
      status: 'signedOut',
    });
    await expect(engine.signIn()).resolves.toMatchObject({ kind: 'cancelled' });

    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
  });

  it('keeps a rotated in-memory session when its stored replacement failed', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    ports.credentials.beforeReplace = (value) =>
      value.includes('refresh-secret-2')
        ? Promise.reject(new Error('keychain busy'))
        : Promise.resolve();
    transport.enqueue(
      oauthTokenReply('access-secret-2', 'refresh-secret-2'),
      apiReply({ id: 'ok' }),
    );

    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    const restored = await engine.restore();
    ports.credentials.beforeReplace = undefined;
    transport.enqueue(apiReply({ id: 'still-live' }));
    const response = await engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });

    expect(restored).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(engine.snapshot.status).toBe('signedIn');
    expect(response.status).toBe(200);
    expect(transport.sent.at(-1)?.headers?.['Authorization']).toBe('Bearer access-secret-2');
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
  });

  it('retries an owed sign-out deletion before restore reads credentials', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.credentials.beforeDelete = () => Promise.reject(new Error('keychain locked'));
    transport.enqueue(new Error('offline'));
    await engine.signOut();
    const readsBeforeRestore = ports.credentials.events.filter((event) => event === 'read').length;
    ports.credentials.beforeDelete = undefined;

    const restored = await engine.restore();

    expect(restored).toEqual({ kind: 'restored', status: 'signedOut' });
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.credentials.events.filter((event) => event === 'read')).toHaveLength(
      readsBeforeRestore + 1,
    );
    expect(engine.snapshot.status).toBe('signedOut');
    const deletesAfterCleanup = ports.credentials.events.filter(
      (event) => event === 'delete:done',
    ).length;
    const readsAfterCleanup = ports.credentials.events.filter((event) => event === 'read').length;

    await expect(engine.restore()).resolves.toEqual({
      kind: 'restored',
      status: 'signedOut',
    });

    expect(ports.credentials.events.filter((event) => event === 'delete:done')).toHaveLength(
      deletesAfterCleanup,
    );
    expect(ports.credentials.events.filter((event) => event === 'read')).toHaveLength(
      readsAfterCleanup + 1,
    );
  });

  it('stores only the refresh token and obtains a fresh access token after restart', async () => {
    const firstTransport = new ScriptedTransport();
    const firstPorts = testPorts(firstTransport);
    const first = createAuthEngine(CONFIG, firstPorts);
    await establishSession(first, firstPorts, firstTransport);
    const stored: { tokens?: { refreshToken?: unknown } } = JSON.parse(
      firstPorts.credentials.value ?? '{}',
    );

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials = firstPorts.credentials;
    ports.install = firstPorts.install;
    const restarted = createAuthEngine(CONFIG, ports);
    await restarted.restore();
    transport.enqueue(
      oauthTokenReply('access-after-restart', 'refresh-after-restart'),
      apiReply({}),
    );
    await restarted.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    expect(Object.keys(stored.tokens ?? {}).sort()).toEqual(['refreshToken']);
    expect(transport.sent.map(({ path }) => path)).toEqual([
      '/api/oauth/token',
      '/api/user/profile',
    ]);
    expect(transport.sent[1]?.headers?.['Authorization']).toBe('Bearer access-after-restart');
    expect(transport.sent[1]?.headers?.['Authorization']).not.toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(stored.tokens?.refreshToken).toBe(REFRESH_TOKEN);
  });

  it('leaves a second engine signed out after it replays a shared-store refresh token', async () => {
    const firstTransport = new ScriptedTransport();
    const firstPorts = testPorts(firstTransport);
    const first = createAuthEngine(CONFIG, firstPorts);
    await establishSession(first, firstPorts, firstTransport);

    const secondTransport = new ScriptedTransport();
    const secondPorts = testPorts(secondTransport);
    secondPorts.credentials = firstPorts.credentials;
    secondPorts.install = firstPorts.install;
    const second = createAuthEngine(CONFIG, secondPorts);
    await second.restore();
    firstPorts.clock.advance(270_000);
    firstTransport.enqueue(oauthTokenReply('access-secret-2', 'refresh-secret-2'), apiReply({}));
    await first.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    secondTransport.enqueue({ status: 400, body: { error: 'invalid_grant' } });
    await expect(
      second.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(OAuthError);
    allowRefreshReplayAfterSharedStoreRace(REFRESH_TOKEN);
    firstPorts.clock.advance(270_000);
    firstTransport.enqueue(new TransportError(TRANSPORT_FAILURE.NO_RESPONSE));

    await expect(
      first.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(TransportError);

    expect(second.snapshot.status).toBe('signedOut');
    expect(first.snapshot).toMatchObject({
      status: 'reauthRequired',
      reason: 'refreshInterrupted',
    });
    const stored = JSON.parse(firstPorts.credentials.value ?? '{}') as {
      refreshInFlight?: boolean;
      tokens?: { refreshToken?: string };
    };
    expect(stored).toMatchObject({
      refreshInFlight: true,
      tokens: { refreshToken: 'refresh-secret-2' },
    });
  });
});

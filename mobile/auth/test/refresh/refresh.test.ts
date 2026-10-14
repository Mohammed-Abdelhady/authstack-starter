import { REFRESH_1_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD, ApiError, OAuthError, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import { AuthSessionError } from '../../src';
import { revokedTokens } from '../support/tracking';
import {
  CONFIG,
  Deferred,
  REFRESH_TOKEN,
  ScriptedTransport,
  apiReply,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  testPorts,
} from '../support/support';

describe('refresh', () => {
  it('coalesces simultaneous expired requests into one refresh', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const reply = new Deferred<ReturnType<typeof oauthTokenReply>>();
    const refreshStarted = new Deferred<void>();
    transport.enqueue(() => reply.promise, apiReply({ id: 'one' }), apiReply({ id: 'two' }));
    transport.onRequest = ({ path, body }) => {
      if (
        path === '/api/oauth/token' &&
        typeof body === 'object' &&
        body !== null &&
        'grant_type' in body &&
        body.grant_type === 'refresh_token'
      )
        refreshStarted.resolve();
    };

    const first = engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    const second = engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    await refreshStarted.promise;
    expect(
      transport.sent.filter(({ body }) => {
        return typeof body === 'object' && body !== null && 'grant_type' in body;
      }),
    ).toHaveLength(2);
    reply.resolve(oauthTokenReply('access-1', REFRESH_1_TOKEN));

    await Promise.all([first, second]);

    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
    expect(
      transport.sent
        .slice(-2)
        .every(({ headers }) => headers?.['Authorization'] === 'Bearer access-1'),
    ).toBe(true);
  });

  it('shares a refresh with a request started by a refreshing snapshot subscriber', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const reply = new Deferred<ReturnType<typeof oauthTokenReply>>();
    const refreshStarted = new Deferred<void>();
    let nested: Promise<unknown> | undefined;
    transport.enqueue(() => reply.promise, apiReply({ id: 'first' }), apiReply({ id: 'second' }));
    transport.onRequest = ({ path, body }) => {
      if (
        path === '/api/oauth/token' &&
        typeof body === 'object' &&
        body !== null &&
        'grant_type' in body &&
        body.grant_type === 'refresh_token'
      )
        refreshStarted.resolve();
    };
    engine.subscribe((snapshot) => {
      if (snapshot.operation === 'refreshing' && !nested) {
        nested = engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
      }
    });

    const first = engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    await refreshStarted.promise;
    reply.resolve(oauthTokenReply('access-1', REFRESH_1_TOKEN));
    await Promise.all([first, nested]);

    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(3);
  });

  it('persists the in-flight marker before sending the rotating refresh token', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    let savedBeforeSend = false;
    transport.enqueue(
      (request) => {
        savedBeforeSend =
          ports.credentials.value !== undefined &&
          ports.credentials.value.includes('"refreshInFlight":true') &&
          ports.credentials.events.at(-1) === 'replace:done' &&
          request.path === '/api/oauth/token';
        return Promise.resolve(oauthTokenReply('access-1', REFRESH_1_TOKEN));
      },
      apiReply({ id: 'profile' }),
    );

    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    expect(savedBeforeSend).toBe(true);
  });

  it('saves rotated tokens before releasing a waiting request', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const writeEntered = new Deferred<void>();
    const finishWrite = new Deferred<void>();
    ports.credentials.beforeReplace = (value) => {
      if (!value.includes(REFRESH_1_TOKEN)) return Promise.resolve();
      writeEntered.resolve();
      return finishWrite.promise;
    };
    transport.enqueue(oauthTokenReply('access-1', REFRESH_1_TOKEN), apiReply({ id: 'profile' }));
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });

    await writeEntered.promise;
    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(1);
    expect(ports.credentials.value).not.toContain(REFRESH_1_TOKEN);
    finishWrite.resolve();
    await request;

    expect(ports.credentials.value).toContain(REFRESH_1_TOKEN);
    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(2);
  });

  it('keeps a refresh marker and requires sign in after a lost answer', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue(new TransportError(TRANSPORT_FAILURE.NO_RESPONSE));

    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(TransportError);

    expect(engine.snapshot.status).toBe('reauthRequired');
    expect(ports.credentials.value).toBeDefined();
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(AuthSessionError);
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
  });

  it('recognizes a saved marker after process restart without sending the old refresh token', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const unanswered = new Deferred<ReturnType<typeof oauthTokenReply>>();
    const refreshStarted = new Deferred<void>();
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/token') refreshStarted.resolve();
    };
    transport.enqueue(() => unanswered.promise);
    const pending = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await refreshStarted.promise;

    const restartedTransport = new ScriptedTransport();
    const restartedPorts = testPorts(restartedTransport);
    restartedPorts.credentials = ports.credentials;
    restartedPorts.install = ports.install;
    const restarted = createAuthEngine(CONFIG, restartedPorts);
    await restarted.restore();

    expect(restarted.snapshot.status).toBe('reauthRequired');
    expect(restartedTransport.sent).toHaveLength(0);
    unanswered.reject(new TransportError(TRANSPORT_FAILURE.NO_RESPONSE));
    await expect(pending).rejects.toBeInstanceOf(TransportError);
  });

  it('keeps a rotated pair in memory when atomic replacement fails', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    let markerRecord: string | undefined;
    let rejectRotation = true;
    ports.credentials.beforeReplace = (value) => {
      if (rejectRotation && value.includes(REFRESH_1_TOKEN)) {
        rejectRotation = false;
        return Promise.reject(new Error('storage locked'));
      }
      return Promise.resolve();
    };
    ports.clock.advance(270_000);
    transport.enqueue(
      (request) => {
        markerRecord = ports.credentials.value;
        expect(request.path).toBe('/api/oauth/token');
        return Promise.resolve(oauthTokenReply('access-1', REFRESH_1_TOKEN));
      },
      apiReply({ id: 'profile' }),
    );

    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    transport.enqueue(apiReply({ id: 'profile-2' }));
    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    expect(engine.snapshot.warning).toBe('storageBlocked');
    expect(ports.credentials.value).toBe(markerRecord);
    expect(transport.sent.at(-1)?.headers?.['Authorization']).toBe('Bearer access-1');
  });

  it('deletes the session and shares the OAuth failure with concurrent waiters', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const failure = { status: 400, body: { error: 'invalid_grant' } };
    transport.enqueue(failure);
    const first = engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    const second = engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    const results = await Promise.allSettled([first, second]);

    expect(results.map(({ status }) => status)).toEqual(['rejected', 'rejected']);
    if (results[0].status === 'rejected' && results[1].status === 'rejected') {
      expect(results[0].reason).toBeInstanceOf(OAuthError);
      expect(results[0].reason).toBe(results[1].reason);
    }
    expect(engine.snapshot.status).toBe('signedOut');
    expect(ports.credentials.value).toBeUndefined();
  });

  it('clears the marker and keeps the session when the application throttles refresh', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue(failedApiReply(429, 'RATE_LIMIT_EXCEEDED'));

    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(engine.snapshot.status).toBe('signedIn');
    expect(ports.credentials.value).toContain(REFRESH_TOKEN);
    expect(ports.credentials.value).not.toContain(REFRESH_1_TOKEN);
  });

  it('revokes a rotated refresh result that arrives after sign out', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const refreshResponse = new Deferred<ReturnType<typeof oauthTokenReply>>();
    const refreshStarted = new Deferred<void>();
    const revokeStarted = new Deferred<void>();
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/token') refreshStarted.resolve();
      if (path === '/api/oauth/revoke') revokeStarted.resolve();
    };
    transport.enqueue(
      () => refreshResponse.promise,
      { status: 200, body: {} },
      { status: 200, body: {} },
    );
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await refreshStarted.promise;
    const signOut = engine.signOut();
    await revokeStarted.promise;
    refreshResponse.resolve(oauthTokenReply('access-1', REFRESH_1_TOKEN));
    await signOut;
    await expect(request).rejects.toBeInstanceOf(AuthSessionError);

    expect(engine.snapshot.status).toBe('signedOut');
    expect(ports.credentials.value).toBeUndefined();
    expect([...revokedTokens(transport)].sort()).toEqual([REFRESH_1_TOKEN, REFRESH_TOKEN].sort());
    expect(ports.timer.pending).toBe(0);
  });

  it('clears every scheduled deadline when refresh callers settle', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue(oauthTokenReply('access-1', REFRESH_1_TOKEN), apiReply({ id: 'profile' }));

    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    expect(ports.timer.pending).toBe(0);
  });
});

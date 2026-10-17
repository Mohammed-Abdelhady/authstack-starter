import { REFRESH_1_TOKEN } from '../support/token-values';
import { assert, describe, expect, it } from 'vitest';
import { HTTP_METHOD, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { AuthSessionError } from '../../src';
import { createAuthEngine } from '../support/engine';
import {
  ACCESS_TOKEN,
  CONFIG,
  Deferred,
  REFRESH_TOKEN,
  ScriptedTransport,
  apiReply,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  readQueryValues,
  successUserReply,
  testPorts,
} from '../support/support';

describe('bearer transport', () => {
  it('does not add the access token to OAuth requests or place tokens in destinations', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue(apiReply({ id: 'profile-2' }));
    await engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile?view=full',
    });

    const oauthRequest = transport.sent.find(({ path }) => path === '/api/oauth/token');
    expect(oauthRequest?.headers?.['Authorization']).toBeUndefined();
    for (const request of transport.sent) {
      expect(request.path).not.toContain(ACCESS_TOKEN);
      expect(request.path).not.toContain(REFRESH_TOKEN);
      const query = readQueryValues(request.path);
      expect([...query.values()]).not.toContain(ACCESS_TOKEN);
      expect([...query.values()]).not.toContain(REFRESH_TOKEN);
    }
  });

  it.each([-1_000_000_000, 1_000_000_000_000])(
    'uses monotonic expiry despite a wall clock jump of %i ms',
    async (jump) => {
      const transport = new ScriptedTransport();
      const ports = testPorts(transport);
      const engine = createAuthEngine(CONFIG, ports);
      await establishSession(engine, ports, transport);
      ports.clock.jumpWall(jump);
      transport.enqueue(apiReply({ id: 'profile-2' }));

      await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

      expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    },
  );

  it('refreshes before sending when the monotonic access-token margin passes', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue(oauthTokenReply('access-1', REFRESH_1_TOKEN), apiReply({ id: 'profile-2' }));

    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    expect(transport.sent.map(({ path }) => path)).toEqual([
      '/api/oauth/token',
      '/api/user/profile',
      '/api/oauth/token',
      '/api/user/profile',
    ]);
    expect(transport.sent.at(-1)?.headers?.['Authorization']).toBe('Bearer access-1');
  });

  it('counts token lifetime from the token request send time', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    transport.enqueue(() => {
      ports.clock.advance(240_000);
      return Promise.resolve(oauthTokenReply());
    }, successUserReply());
    ports.authBrowser.results.push((address) => ({
      kind: 'redirect',
      url: `${CONFIG.redirectUri}?code=code&state=${readQueryValues(address).get('state')}`,
    }));
    const signInResult = await engine.signIn();
    expect(signInResult.kind).toBe('signedIn');
    ports.clock.advance(31_000);
    transport.enqueue(oauthTokenReply('access-1', REFRESH_1_TOKEN), apiReply({ id: 'profile-2' }));

    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
  });

  it('refreshes once and repeats an API request once after 401', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue(
      failedApiReply(401, 'SESSION_INVALID'),
      oauthTokenReply('access-1', REFRESH_1_TOKEN),
      apiReply({ id: 'profile-2' }),
    );

    const response = await engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });

    expect(response.status).toBe(200);
    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(3);
  });

  it('does not loop when the retry after a 401 also returns 401', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue(
      failedApiReply(401, 'SESSION_INVALID'),
      oauthTokenReply('access-1', REFRESH_1_TOKEN),
      failedApiReply(401, 'SESSION_INVALID'),
    );

    const response = await engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });

    expect(response.status).toBe(401);
    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(3);
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
  });

  it('reuses a newer token for a request whose old-token 401 arrives late', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    let answerOldRequest: ((response: { status: number; body: unknown }) => void) | undefined;
    const oldRequestStarted = new Deferred<void>();
    transport.enqueue(
      (request) =>
        new Promise((resolve) => {
          answerOldRequest = resolve;
          expect(request.headers?.['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
          oldRequestStarted.resolve();
        }),
    );
    const first = engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    await oldRequestStarted.promise;
    ports.clock.advance(270_000);
    transport.enqueue(oauthTokenReply('access-1', REFRESH_1_TOKEN), apiReply({ id: 'profile-2' }));
    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    transport.enqueue(apiReply({ id: 'profile-3' }));
    answerOldRequest?.(failedApiReply(401, 'SESSION_INVALID'));

    await first;

    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
    expect(transport.sent.at(-1)?.headers?.['Authorization']).toBe('Bearer access-1');
  });

  it('repeats a GET once after a no-response failure', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue(
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
      apiReply({ id: 'profile-2' }),
    );

    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).resolves.toMatchObject({ status: 200 });

    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(3);
  });

  it('does not repeat a write after a no-response failure', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue(new TransportError(TRANSPORT_FAILURE.NO_RESPONSE));

    await expect(
      engine.transport.request({
        method: HTTP_METHOD.PATCH,
        path: '/api/user/profile',
        body: { name: 'Changed' },
      }),
    ).rejects.toBeInstanceOf(TransportError);

    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(2);
  });

  it('drops caller authorization and cookies before adding the bearer token', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    transport.enqueue(apiReply({ id: 'profile' }));

    await engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
      headers: {
        Authorization: 'Bearer caller-token',
        Cookie: 'session=web',
        cOoKiE: 'second=web',
        'X-Trace': 'trace-1',
      },
    });

    assert.isDefined(transport.sent[0]);
    expect(transport.sent[0].headers).toEqual({
      'X-Trace': 'trace-1',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    });
  });

  it('does not resend a request when sign out wins after refresh completes', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    const refresh = new Deferred<ReturnType<typeof oauthTokenReply>>();
    const refreshStarted = new Deferred<void>();
    const refreshFinished = new Deferred<void>();
    let signOut: Promise<{ kind: string }> | undefined;
    let watch = false;
    engine.subscribe((snapshot) => {
      if (watch && snapshot.status === 'signedIn' && snapshot.operation === 'none') {
        watch = false;
        signOut = engine.signOut();
        refreshFinished.resolve();
      }
    });
    watch = true;
    transport.enqueue(
      failedApiReply(401, 'SESSION_INVALID'),
      () => refresh.promise,
      apiReply({ id: 'should-not-be-requested' }),
      { status: 200, body: {} },
    );
    transport.onRequest = ({ path, body }) => {
      if (path === '/api/oauth/token' && isRefreshBody(body)) refreshStarted.resolve();
    };

    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await refreshStarted.promise;
    refresh.resolve(oauthTokenReply('access-1', REFRESH_1_TOKEN));
    await refreshFinished.promise;

    await expect(request).rejects.toBeInstanceOf(AuthSessionError);
    await signOut;
    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(1);
  });
});

function isRefreshBody(value: unknown): value is { grant_type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'grant_type' in value &&
    value.grant_type === 'refresh_token'
  );
}

import { REFRESH_AFTER_BACKOFF_TOKEN, REFRESH_AFTER_RESTART_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { ApiError, HTTP_METHOD } from '@app/sdk';
import { REFRESH_THROTTLE_BACKOFF_MS } from '../../src/constants';
import { allowRefreshReplayAfterThrottle } from '../support/tracking';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  Deferred,
  REFRESH_TOKEN,
  ScriptedTransport,
  apiReply,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../support/support';

describe('refresh after a throttled answer and restart', () => {
  it('shares one retry after the throttle backoff deadline', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    let refreshAnswer: { status: number; body: unknown } = {
      status: 429,
      body: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'slow down' } },
    };
    const backoffScheduled = new Deferred<void>();
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === REFRESH_THROTTLE_BACKOFF_MS) backoffScheduled.resolve();
    };
    transport.respond = (request) => {
      if (isRefreshRequest(request.path, request.body)) {
        return Promise.resolve(refreshAnswer);
      }
      if (request.path === '/api/user/profile') return Promise.resolve(apiReply({ id: 'profile' }));
      return Promise.reject(new Error(`Unexpected request: ${request.path}`));
    };
    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(ApiError);
    allowRefreshReplayAfterThrottle(REFRESH_TOKEN);

    const requests = Array.from({ length: 4 }, () =>
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    );
    await backoffScheduled.promise;
    refreshAnswer = oauthTokenReply('access-after-backoff', REFRESH_AFTER_BACKOFF_TOKEN);
    ports.clock.advance(REFRESH_THROTTLE_BACKOFF_MS);
    ports.timer.fireDelay(REFRESH_THROTTLE_BACKOFF_MS);
    const results = await Promise.allSettled(requests);
    const refreshes = transport.sent.filter(({ path, body }) => isRefreshRequest(path, body));

    expect(refreshes).toHaveLength(2);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ]);
  });

  it('reuses the token only after a 429 that did not reach the rotation handler', async () => {
    const firstTransport = new ScriptedTransport();
    const firstPorts = testPorts(firstTransport);
    const first = createAuthEngine(CONFIG, firstPorts);
    await establishSession(first, firstPorts, firstTransport);
    firstPorts.clock.advance(270_000);
    firstTransport.enqueue({
      status: 429,
      body: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'slow down' } },
    });

    await expect(
      first.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(ApiError);
    allowRefreshReplayAfterThrottle(REFRESH_TOKEN);

    const nextTransport = new ScriptedTransport();
    const nextPorts = testPorts(nextTransport);
    nextPorts.credentials = firstPorts.credentials;
    nextPorts.install = firstPorts.install;
    const restarted = createAuthEngine(CONFIG, nextPorts);
    await restarted.restore();
    nextTransport.enqueue(
      oauthTokenReply('access-after-restart', REFRESH_AFTER_RESTART_TOKEN),
      apiReply({ id: 'profile' }),
    );

    const response = await restarted.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });

    expect(response.status).toBe(200);
    const refreshTokens = [...firstTransport.sent, ...nextTransport.sent].flatMap(
      ({ path, body }) =>
        path === '/api/oauth/token' &&
        typeof body === 'object' &&
        body !== null &&
        'grant_type' in body &&
        body.grant_type === 'refresh_token' &&
        'refresh_token' in body &&
        typeof body.refresh_token === 'string'
          ? [body.refresh_token]
          : [],
    );
    expect(refreshTokens).toEqual([REFRESH_TOKEN, REFRESH_TOKEN]);
  });

  it('clears an elapsed throttle deadline before a later clock rollback', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    let refreshCount = 0;
    let rejectNextProfile = false;
    transport.respond = async ({ path, body }) => {
      if (isRefreshRequest(path, body)) {
        refreshCount += 1;
        if (refreshCount === 1)
          return {
            status: 429,
            body: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'slow down' } },
          };
        return oauthTokenReply(`access-${refreshCount}`, `refresh-${refreshCount}`);
      }
      if (path === '/api/user/profile' && rejectNextProfile) {
        rejectNextProfile = false;
        return { status: 401, body: { success: false, error: { code: 'SESSION_INVALID' } } };
      }
      return apiReply({ id: 'profile' });
    };
    const initialWait = new Deferred<void>();
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === REFRESH_THROTTLE_BACKOFF_MS) initialWait.resolve();
    };
    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(ApiError);
    allowRefreshReplayAfterThrottle(REFRESH_TOKEN);
    const retry = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await initialWait.promise;
    ports.clock.advance(REFRESH_THROTTLE_BACKOFF_MS);
    ports.timer.fireDelay(REFRESH_THROTTLE_BACKOFF_MS);
    await expect(retry).resolves.toMatchObject({ status: 200 });

    ports.clock.elapsed -= 600_000;
    rejectNextProfile = true;
    const refreshStarted = new Deferred<void>();
    const longWaitScheduled = new Deferred<void>();
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds > REFRESH_THROTTLE_BACKOFF_MS) longWaitScheduled.resolve();
    };
    transport.onRequest = ({ path, body }) => {
      if (isRefreshRequest(path, body)) refreshStarted.resolve();
    };
    const afterRollback = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    const action = await Promise.race([
      refreshStarted.promise.then(() => 'refresh' as const),
      longWaitScheduled.promise.then(() => 'backoff' as const),
    ]);
    if (action === 'backoff') {
      ports.clock.advance(600_000);
      ports.timer.fireAll();
    }
    await afterRollback;

    expect(action).toBe('refresh');
    expect(refreshCount).toBe(3);
    engine.dispose();
  });
});

function isRefreshRequest(
  path: string,
  body: unknown,
): body is { grant_type: string; refresh_token: string } {
  return (
    path === '/api/oauth/token' &&
    typeof body === 'object' &&
    body !== null &&
    'grant_type' in body &&
    body.grant_type === 'refresh_token' &&
    'refresh_token' in body &&
    typeof body.refresh_token === 'string'
  );
}

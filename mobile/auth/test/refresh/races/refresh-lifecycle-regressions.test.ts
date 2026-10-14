import { REFRESH_SECRET_2_TOKEN, ACCESS_SECRET_2_TOKEN } from '../../support/token-values';
import { describe, expect, it } from 'vitest';
import { ApiError, HTTP_METHOD, TRANSPORT_FAILURE } from '@app/sdk';
import { PortAbortController } from '../../../src/runtime/abort-controller';
import { REFRESH_THROTTLE_BACKOFF_MS } from '../../../src/constants';
import { AuthDisposedError, AuthSessionError } from '../../../src/errors/errors';
import { createAuthEngine } from '../../support/engine';
import { allowRefreshReplayAfterNonRotatingFailure, revokedTokens } from '../../support/tracking';
import {
  CONFIG,
  Deferred,
  REFRESH_TOKEN,
  ScriptedTransport,
  apiReply,
  acceptCode,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  successUserReply,
  testPorts,
} from '../../support/support';

describe('refresh waiters and known non-rotation failures', () => {
  it('releases and cancels a throttled refresh wait when sign-out starts', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    ports.clock.advance(270_000);
    transport.enqueue(failedApiReply(429, 'RATE_LIMIT_EXCEEDED'));
    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(ApiError);
    const backoff = new Deferred<void>();
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === REFRESH_THROTTLE_BACKOFF_MS) backoff.resolve();
    };
    const waiting = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    const settled = new Deferred<unknown>();
    void waiting.then(
      (value) => settled.resolve(value),
      (error: unknown) => settled.resolve(error),
    );
    await backoff.promise;
    await engine.restore();
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    transport.enqueue({ status: 200, body: {} });

    const signOut = engine.signOut();
    const race = await Promise.race([
      settled.promise.then((value) => ({ kind: 'request' as const, value })),
      signOut.then(() => ({ kind: 'signOut' as const })),
    ]);
    const outcome = race.kind === 'request' ? race.value : undefined;
    if (outcome === undefined) ports.timer.fireAll();
    await signOut;
    if (race.kind !== 'request') await waiting.catch(() => undefined);

    expect(race.kind).toBe('request');
    expect(outcome).toBeInstanceOf(AuthSessionError);
    expect(ports.timer.pending).toBe(0);
    expect(engine.snapshot.operation).toBe('none');
  });

  it('releases and cancels a backoff waiter when the engine is disposed', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    ports.clock.advance(270_000);
    transport.enqueue(failedApiReply(429, 'RATE_LIMIT_EXCEEDED'));
    await engine.transport
      .request({ method: HTTP_METHOD.GET, path: '/api/user/profile' })
      .catch(() => undefined);
    const backoff = new Deferred<void>();
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === REFRESH_THROTTLE_BACKOFF_MS) backoff.resolve();
    };
    const waiting = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await backoff.promise;

    engine.dispose();

    await expect(waiting).rejects.toBeInstanceOf(AuthDisposedError);
    expect(ports.timer.pending).toBe(0);
    expect(engine.snapshot.operation).toBe('none');
  });

  it('honors a caller abort while waiting through a throttle backoff', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    ports.clock.advance(270_000);
    transport.enqueue(failedApiReply(429, 'RATE_LIMIT_EXCEEDED'));
    await engine.transport
      .request({ method: HTTP_METHOD.GET, path: '/api/user/profile' })
      .catch(() => undefined);
    const backoff = new Deferred<void>();
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === REFRESH_THROTTLE_BACKOFF_MS) backoff.resolve();
    };
    const controller = new PortAbortController();
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
      signal: controller.signal,
    });
    await backoff.promise;
    controller.abort();

    await expect(request).rejects.toMatchObject({
      name: 'TransportError',
      reason: TRANSPORT_FAILURE.ABORTED,
    });
    expect(ports.timer.pendingDelays).not.toContain(REFRESH_THROTTLE_BACKOFF_MS);
    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(0);
    expect(
      transport.sent.filter(
        ({ path, body }) =>
          path === '/api/oauth/token' &&
          typeof body === 'object' &&
          body !== null &&
          'grant_type' in body &&
          body.grant_type === 'refresh_token',
      ),
    ).toHaveLength(1);
    engine.dispose();
    expect(ports.timer.pending).toBe(0);
  });

  it('does not resend a protected request after its caller aborts during refresh', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    ports.clock.advance(270_000);
    const refreshStarted = new Deferred<void>();
    const refreshAnswer = new Deferred<{ status: number; body: unknown }>();
    const rotatedRecord = new Deferred<void>();
    ports.credentials.afterReplace = (value) => {
      if (value.includes(REFRESH_SECRET_2_TOKEN)) rotatedRecord.resolve();
    };
    transport.enqueue(() => {
      refreshStarted.resolve();
      return refreshAnswer.promise;
    });
    const controller = new PortAbortController();
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
      signal: controller.signal,
    });
    await refreshStarted.promise;
    controller.abort();
    refreshAnswer.resolve(oauthTokenReply(ACCESS_SECRET_2_TOKEN, REFRESH_SECRET_2_TOKEN));
    await rotatedRecord.promise;

    await expect(request).rejects.toMatchObject({
      name: 'TransportError',
      reason: TRANSPORT_FAILURE.ABORTED,
    });
    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(0);
    expect(engine.snapshot.status).toBe('signedIn');
    expect(ports.timer.pending).toBe(0);
  });

  it('keeps the grant after authority rollback and shares one retry after backoff', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue(failedApiReply(503, 'AUTHORITY_UNAVAILABLE'));

    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(engine.snapshot.status).toBe('signedIn');
    expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
    const backoff = new Deferred<void>();
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === REFRESH_THROTTLE_BACKOFF_MS) backoff.resolve();
    };
    transport.enqueue(oauthTokenReply(ACCESS_SECRET_2_TOKEN, REFRESH_SECRET_2_TOKEN), apiReply({}));
    allowRefreshReplayAfterNonRotatingFailure(REFRESH_TOKEN);
    const waiting = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await backoff.promise;
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);

    ports.clock.advance(REFRESH_THROTTLE_BACKOFF_MS);
    ports.timer.fireDelay(REFRESH_THROTTLE_BACKOFF_MS);
    const response = await waiting;

    expect(response.status).toBe(200);
    expect(engine.snapshot.status).toBe('signedIn');
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(3);
    expect(revokedTokens(transport)).toEqual([]);
  });

  it('does not carry an old throttle deadline into a new short-lived session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    let refreshAttempts = 0;
    transport.respond = async ({ path, body }) => {
      if (path === '/api/oauth/revoke') return { status: 200, body: {} };
      if (path === '/api/oauth/token') {
        if (
          typeof body === 'object' &&
          body !== null &&
          'grant_type' in body &&
          body.grant_type === 'authorization_code'
        )
          return oauthTokenReply('short-access', 'short-refresh', 35);
        refreshAttempts += 1;
        if (refreshAttempts === 1) return failedApiReply(429, 'RATE_LIMIT_EXCEEDED');
        return oauthTokenReply('fresh-access', 'fresh-refresh');
      }
      return successUserReply();
    };
    await engine.transport
      .request({ method: HTTP_METHOD.GET, path: '/api/user/profile' })
      .catch(() => undefined);
    await engine.signOut();
    acceptCode(ports.authBrowser);
    await expect(engine.signIn()).resolves.toMatchObject({ kind: 'signedIn' });
    ports.clock.advance(6_000);
    const refreshStarted = new Deferred<void>();
    const backoffStarted = new Deferred<void>();
    let refreshWaitScheduled = false;
    ports.timer.onSchedule = (milliseconds) => {
      if (milliseconds === REFRESH_THROTTLE_BACKOFF_MS) {
        refreshWaitScheduled = true;
        backoffStarted.resolve();
      }
    };
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
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    const firstAction = await Promise.race([
      refreshStarted.promise.then(() => 'refresh' as const),
      backoffStarted.promise.then(() => 'backoff' as const),
    ]);
    if (firstAction === 'backoff') {
      ports.clock.advance(REFRESH_THROTTLE_BACKOFF_MS);
      ports.timer.fireDelay(REFRESH_THROTTLE_BACKOFF_MS);
    }
    await request;

    expect(firstAction).toBe('refresh');
    expect(refreshWaitScheduled).toBe(false);
  });
});

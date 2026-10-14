import { describe, expect, it } from 'vitest';
import {
  ApiError,
  HTTP_METHOD,
  OAuthError,
  TransportError,
  TRANSPORT_FAILURE,
  type TransportSignal,
} from '@app/sdk';
import { createAuthEngine } from '../../support/engine';
import { AuthSessionError } from '../../../src';
import { revokedTokens } from '../../support/tracking';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  apiReply,
  acceptCode,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  successUserReply,
  testPorts,
} from '../../support/support';

describe('refresh during sign out', () => {
  it.each(['lost answer', 'invalid_grant'] as const)(
    'does not replay a pending write with the next account after %s',
    async (failure) => {
      const transport = new ScriptedTransport();
      const ports = testPorts(transport);
      const engine = createAuthEngine(CONFIG, ports);
      await establishSession(engine, ports, transport);
      const oldWriteResponse = new Deferred<{ status: number; body: unknown }>();
      if (failure === 'lost answer') {
        transport.enqueue(
          () => oldWriteResponse.promise,
          failedApiReply(401, 'SESSION_INVALID'),
          new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
          { status: 200, body: {} },
          oauthTokenReply('access-account-b', 'refresh-account-b'),
          successUserReply(),
        );
      } else {
        transport.enqueue(
          () => oldWriteResponse.promise,
          failedApiReply(401, 'SESSION_INVALID'),
          { status: 400, body: { error: 'invalid_grant' } },
          oauthTokenReply('access-account-b', 'refresh-account-b'),
          successUserReply(),
        );
      }

      const oldWrite = engine.transport.request({
        method: HTTP_METHOD.PATCH,
        path: '/api/user/profile',
        body: { name: 'Account A change' },
      });
      const refreshRequest = engine.transport.request({
        method: HTTP_METHOD.GET,
        path: '/api/user/profile',
      });
      await expect(refreshRequest).rejects.toBeInstanceOf(
        failure === 'lost answer' ? TransportError : OAuthError,
      );
      acceptCode(ports.authBrowser);
      const signInOutcome = await engine.signIn();
      oldWriteResponse.resolve(failedApiReply(401, 'SESSION_INVALID'));
      const oldWriteResult = await Promise.allSettled([oldWrite]);

      expect(signInOutcome.kind).toBe('signedIn');
      expect(oldWriteResult[0]?.status).toBe('rejected');
      if (oldWriteResult[0]?.status === 'rejected')
        expect(oldWriteResult[0].reason).toBeInstanceOf(AuthSessionError);
      const writes = transport.sent.filter(
        ({ method, path }) => method === HTTP_METHOD.PATCH && path === '/api/user/profile',
      );
      expect(writes).toHaveLength(1);
      expect(writes[0]?.headers?.['Authorization']).toBe('Bearer access-secret-0');
    },
  );

  it('never resends a refresh token after its first answer is lost', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const firstResponse = new Deferred<{ status: number; body: unknown }>();
    const secondResponse = new Deferred<{ status: number; body: unknown }>();
    const bothSent = new Deferred<void>();
    let requestsSent = 0;
    transport.enqueue(
      () => firstResponse.promise,
      () => secondResponse.promise,
      new TransportError(TRANSPORT_FAILURE.NO_RESPONSE),
    );
    transport.onRequest = ({ path }) => {
      if (path !== '/api/user/profile') return;
      requestsSent += 1;
      if (requestsSent === 2) bothSent.resolve();
    };

    const first = engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    const second = engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    await bothSent.promise;
    firstResponse.resolve(failedApiReply(401, 'SESSION_INVALID'));
    await expect(first).rejects.toBeInstanceOf(TransportError);
    expect(engine.snapshot.status).toBe('reauthRequired');
    secondResponse.resolve(failedApiReply(401, 'SESSION_INVALID'));

    await expect(second).rejects.toBeInstanceOf(AuthSessionError);
    expect(refreshRequests(transport)).toHaveLength(1);
  });

  it('aborts refresh at its deadline and never resends the old token', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const refreshStarted = new Deferred<void>();
    const refreshAnswer = new Deferred<{ status: number; body: unknown }>();
    let refreshSignal: TransportSignal | undefined;
    transport.onRequest = ({ path, body, signal }) => {
      if (path === '/api/oauth/token' && isRefreshBody(body)) {
        refreshSignal = signal;
        refreshStarted.resolve();
      }
    };
    transport.enqueue(failedApiReply(401, 'SESSION_INVALID'), () => refreshAnswer.promise);
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await refreshStarted.promise;
    ports.timer.fireDelay(15_000);

    await expect(request).rejects.toBeInstanceOf(TransportError);
    expect(refreshSignal?.aborted).toBe(true);
    expect(engine.snapshot.status).toBe('reauthRequired');
    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(AuthSessionError);
    expect(refreshRequests(transport)).toHaveLength(1);
    expect(ports.timer.pending).toBe(0);
  });

  it('writes a clean token record after a failed successful-rotation write', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    rejectFirstRotationWrite(ports);
    ports.clock.advance(270_000);
    transport.enqueue(oauthTokenReply('access-1', 'refresh-1'), apiReply({ id: 'first' }));
    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    ports.clock.advance(270_000);
    transport.enqueue(oauthTokenReply('access-2', 'refresh-2'), apiReply({ id: 'second' }));

    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    expect(ports.credentials.value).toContain('refresh-2');
    expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
  });

  it('writes a clean token record when a retry refresh is throttled', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    rejectFirstRotationWrite(ports);
    ports.clock.advance(270_000);
    transport.enqueue(oauthTokenReply('access-1', 'refresh-1'), apiReply({ id: 'first' }));
    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    ports.clock.advance(270_000);
    transport.enqueue({
      status: 429,
      body: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'slow down' } },
    });

    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(ports.credentials.value).toContain('refresh-1');
    expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
  });

  it('does not restore a rotated pair when its storage write fails after sign out', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const refreshResponse = new Deferred<ReturnType<typeof oauthTokenReply>>();
    const refreshStarted = new Deferred<void>();
    const rotationWriteStarted = new Deferred<void>();
    const finishRotationWrite = new Deferred<void>();
    const deleteStarted = new Deferred<void>();
    const finishDelete = new Deferred<void>();
    const requestSettled = new Deferred<void>();
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/token') refreshStarted.resolve();
    };
    ports.credentials.beforeReplace = (value) => {
      if (value.includes('refresh-rotated')) {
        rotationWriteStarted.resolve();
        return finishRotationWrite.promise;
      }
      return Promise.resolve();
    };
    ports.credentials.beforeDelete = () => {
      deleteStarted.resolve();
      return finishDelete.promise;
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
    refreshResponse.resolve(oauthTokenReply('access-rotated', 'refresh-rotated'));
    await rotationWriteStarted.promise;

    const requestResult = request
      .then(
        () => {
          throw new Error('Expected the request to fail after sign out');
        },
        (error: unknown) => {
          expect(error).toBeInstanceOf(AuthSessionError);
        },
      )
      .finally(() => requestSettled.resolve());
    const signOut = engine.signOut();
    finishRotationWrite.reject(new Error('storage write failed'));
    await deleteStarted.promise;
    await requestSettled.promise;

    try {
      expect(engine.snapshot.status).toBe('signedOut');
      expect(engine.snapshot.operation).toBe('signingOut');
      const previousProfileRequests = transport.sent.filter(
        ({ path }) => path === '/api/user/profile',
      ).length;
      await expect(
        engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
      ).rejects.toBeInstanceOf(AuthSessionError);
      expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(
        previousProfileRequests,
      );
    } finally {
      finishDelete.resolve();
    }
    await Promise.all([signOut, requestResult]);

    expect(engine.snapshot.status).toBe('signedOut');
    expect([...revokedTokens(transport)].sort()).toEqual(
      ['refresh-rotated', 'refresh-secret-0'].sort(),
    );
    expect(ports.timer.pending).toBe(0);
  });
});

function rejectFirstRotationWrite(ports: ReturnType<typeof testPorts>): void {
  let reject = true;
  ports.credentials.beforeReplace = (value) => {
    if (reject && value.includes('refresh-1')) {
      reject = false;
      return Promise.reject(new Error('temporary storage failure'));
    }
    return Promise.resolve();
  };
}

function refreshRequests(transport: ScriptedTransport): unknown[] {
  return transport.sent.filter(
    ({ path, body }) => path === '/api/oauth/token' && isRefreshBody(body),
  );
}

function isRefreshBody(value: unknown): value is { grant_type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'grant_type' in value &&
    value.grant_type === 'refresh_token'
  );
}

import { HTTP_METHOD, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { AuthSessionError } from '../../src';
import { createAuthEngine } from '../support/engine';
import {
  ACCESS_TOKEN,
  CONFIG,
  Deferred,
  REFRESH_TOKEN,
  ScriptedTransport,
  acceptCode,
  apiReply,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  testPorts,
  USER,
} from '../support/support';

describe('request session epochs', () => {
  it('does not replay a prior account write with the next account token', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const oldWriteStarted = new Deferred<void>();
    const oldWriteAnswer = new Deferred<{ status: number; body: unknown }>();
    const refreshStarted = new Deferred<void>();
    const refreshAnswer = new Deferred<{ status: number; body: unknown }>();
    let firstProfileRequest = true;
    transport.respond = (request) => {
      if (request.path === '/api/oauth/token' && isRefresh(request.body)) {
        refreshStarted.resolve();
        return refreshAnswer.promise;
      }
      if (request.path === '/api/oauth/token')
        return Promise.resolve(oauthTokenReply('person-b-access', 'person-b-refresh'));
      if (request.path === '/api/oauth/revoke') return Promise.resolve(apiReply({}));
      if (request.path === '/api/user/profile' && request.method === HTTP_METHOD.PATCH) {
        oldWriteStarted.resolve();
        return oldWriteAnswer.promise;
      }
      if (request.path === '/api/user/profile' && firstProfileRequest) {
        firstProfileRequest = false;
        return Promise.resolve(failedApiReply(401, 'SESSION_INVALID'));
      }
      if (request.path === '/api/user/profile')
        return Promise.resolve(apiReply({ ...USER, id: 'person-b' }));
      return Promise.reject(new Error(`Unexpected request: ${request.path}`));
    };

    const oldWrite = engine.transport.request({
      method: HTTP_METHOD.PATCH,
      path: '/api/user/profile',
      body: { name: 'Account A change' },
    });
    await oldWriteStarted.promise;
    const refreshRequest = engine.transport
      .request({ method: HTTP_METHOD.GET, path: '/api/user/profile' })
      .catch((error: unknown) => error);
    await refreshStarted.promise;
    refreshAnswer.reject(new TransportError(TRANSPORT_FAILURE.NO_RESPONSE));
    await expect(refreshRequest).resolves.toBeInstanceOf(TransportError);
    expect(engine.snapshot.status).toBe('reauthRequired');

    acceptCode(ports.authBrowser, 'person-b-code');
    await expect(engine.signIn()).resolves.toMatchObject({ kind: 'signedIn' });
    oldWriteAnswer.resolve(failedApiReply(401, 'SESSION_INVALID'));

    await expect(oldWrite).rejects.toBeInstanceOf(AuthSessionError);
    const writes = transport.sent.filter(
      ({ method, path }) => method === HTTP_METHOD.PATCH && path === '/api/user/profile',
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.headers?.['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(engine.snapshot.profile?.id).toBe('person-b');
    expect(refreshTokens(transport)).toEqual([REFRESH_TOKEN]);
  });
});

function isRefresh(value: unknown): value is { grant_type: string; refresh_token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'grant_type' in value &&
    value.grant_type === 'refresh_token' &&
    'refresh_token' in value &&
    typeof value.refresh_token === 'string'
  );
}

function refreshTokens(transport: ScriptedTransport): string[] {
  return transport.sent.flatMap(({ path, body }) =>
    path === '/api/oauth/token' && isRefresh(body) ? [body.refresh_token] : [],
  );
}

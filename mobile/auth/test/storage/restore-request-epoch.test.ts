import { REFRESH_AFTER_RESTORE_TOKEN } from '../support/token-values';
import { HTTP_METHOD } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import {
  ACCESS_TOKEN,
  CONFIG,
  Deferred,
  ScriptedTransport,
  apiReply,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  testPorts,
} from '../support/support';

describe('request epochs across restore', () => {
  it('keeps a request active when restore preserves its in-memory session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    const firstResponse = new Deferred<{ status: number; body: unknown }>();
    const firstProfileStarted = new Deferred<void>();
    let profileRequests = 0;
    transport.respond = (request) => {
      if (request.path === '/api/oauth/token')
        return Promise.resolve(
          oauthTokenReply('access-after-restore', REFRESH_AFTER_RESTORE_TOKEN),
        );
      if (request.path === '/api/user/profile') {
        profileRequests += 1;
        if (profileRequests === 1) {
          firstProfileStarted.resolve();
          return firstResponse.promise;
        }
        return Promise.resolve(apiReply({ id: 'restored-session' }));
      }
      return Promise.reject(new Error(`Unexpected request: ${request.path}`));
    };
    const oldRequest = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await firstProfileStarted.promise;

    const restore = engine.restore();
    await expect(restore).resolves.toMatchObject({ status: 'signedIn' });
    firstResponse.resolve(failedApiReply(401, 'SESSION_INVALID'));
    const requestResult = await oldRequest;

    expect(requestResult.status).toBe(200);
    expect(profileRequests).toBe(2);
    expect(transport.sent[0]?.headers?.['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
  });
});

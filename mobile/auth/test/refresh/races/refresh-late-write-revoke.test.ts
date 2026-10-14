import { REFRESH_NEXT_TOKEN } from '../../support/token-values';
import { HTTP_METHOD } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { AuthSessionError } from '../../../src';
import { createAuthEngine } from '../../support/engine';
import { revokedTokens } from '../../support/tracking';
import {
  REFRESH_TOKEN,
  CONFIG,
  Deferred,
  ScriptedTransport,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  testPorts,
} from '../../support/support';

describe('late refresh write revocation', () => {
  it('revokes the old and rotated token once when sign-out wins the write race', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const rotationStarted = new Deferred<void>();
    const finishRotation = new Deferred<void>();
    const revokeStarted = new Deferred<void>();
    ports.credentials.beforeReplace = (value) => {
      if (!value.includes(`"refreshToken":"${REFRESH_NEXT_TOKEN}"`)) return Promise.resolve();
      rotationStarted.resolve();
      return finishRotation.promise;
    };
    transport.respond = (request) => {
      if (request.path === '/api/user/profile')
        return Promise.resolve(failedApiReply(401, 'SESSION_INVALID'));
      if (request.path === '/api/oauth/token')
        return Promise.resolve(oauthTokenReply('access-next', REFRESH_NEXT_TOKEN));
      if (request.path === '/api/oauth/revoke') {
        revokeStarted.resolve();
        return Promise.resolve({ status: 200, body: {} });
      }
      return Promise.reject(new Error(`Unexpected request: ${request.path}`));
    };

    const request = engine.transport
      .request({ method: HTTP_METHOD.GET, path: '/api/user/profile' })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await rotationStarted.promise;
    const signOut = engine.signOut();
    await revokeStarted.promise;
    finishRotation.resolve();
    const [requestError, signOutResult] = await Promise.all([request, signOut]);

    expect(requestError).toBeInstanceOf(AuthSessionError);
    expect(signOutResult).toMatchObject({ kind: 'signedOut', revocation: 'revoked' });
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN, REFRESH_NEXT_TOKEN]);
  });
});

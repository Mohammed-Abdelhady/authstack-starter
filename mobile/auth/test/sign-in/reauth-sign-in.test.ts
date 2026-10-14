import { REFRESH_NEW_TOKEN } from '../support/token-values';
import { HTTP_METHOD, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import { revokedTokens } from '../support/tracking';
import {
  Deferred,
  CONFIG,
  REFRESH_TOKEN,
  ScriptedTransport,
  acceptCode,
  apiReply,
  establishSession,
  oauthTokenReply,
  successUserReply,
  testPorts,
} from '../support/support';

describe('sign-in after an unknown refresh', () => {
  it('revokes the previous family without waiting for revocation to finish', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue(new TransportError(TRANSPORT_FAILURE.NO_RESPONSE));
    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(TransportError);

    const revokeAnswer = new Deferred<ReturnType<typeof apiReply>>();
    const browserOpened = new Deferred<void>();
    const revokeFinished = new Deferred<void>();
    const revokeTimerCancelled = new Deferred<void>();
    ports.authBrowser.beforeOpen = () => {
      ports.timer.onCancel = (milliseconds) => {
        if (milliseconds === 5_000) revokeTimerCancelled.resolve();
      };
      browserOpened.resolve();
    };
    transport.onResponse = ({ path }) => {
      if (path === '/api/oauth/revoke') revokeFinished.resolve();
    };
    acceptCode(ports.authBrowser);
    transport.respond = (request) => {
      if (request.path === '/api/oauth/revoke') return revokeAnswer.promise;
      if (request.path === '/api/oauth/token')
        return Promise.resolve(oauthTokenReply('access-new', REFRESH_NEW_TOKEN));
      if (request.path === '/api/user/profile') return Promise.resolve(successUserReply());
      return Promise.reject(new Error(`Unexpected request: ${request.path}`));
    };

    const signIn = engine.signIn();
    await browserOpened.promise;
    await expect(signIn).resolves.toMatchObject({ kind: 'signedIn' });

    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(engine.snapshot.status).toBe('signedIn');
    revokeAnswer.resolve(apiReply({ ok: true }));
    await revokeFinished.promise;
    await revokeTimerCancelled.promise;
  });
});

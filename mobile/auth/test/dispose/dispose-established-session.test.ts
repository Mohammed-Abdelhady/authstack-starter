import { REFRESH_SECRET_2_TOKEN, ACCESS_SECRET_2_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import { AuthDisposedError } from '../../src/errors/errors';
import { CREDENTIAL_WRITE_TIMEOUT_MS, OAUTH_REFRESH_TIMEOUT_MS } from '../../src/constants';
import { createAuthEngine } from '../support/engine';
import { revokedTokens } from '../support/tracking';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../support/support';

describe('disposing an established or pending session', () => {
  it('persists a refresh that completes after disposal without revoking it', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const refreshStarted = new Deferred<void>();
    const refreshAnswer = new Deferred<{ status: number; body: unknown }>();
    const finished = new Deferred<'persisted' | 'revoked'>();
    const refreshDeadlineCancelled = new Deferred<void>();
    const rotatedWriteDeadlineCancelled = new Deferred<void>();
    let rotatedWriteStarted = false;
    ports.timer.onCancel = (milliseconds) => {
      if (milliseconds === OAUTH_REFRESH_TIMEOUT_MS) refreshDeadlineCancelled.resolve();
      if (milliseconds === CREDENTIAL_WRITE_TIMEOUT_MS && rotatedWriteStarted)
        rotatedWriteDeadlineCancelled.resolve();
    };
    ports.credentials.afterReplace = (value) => {
      if (!value.includes(REFRESH_SECRET_2_TOKEN)) return;
      rotatedWriteStarted = true;
      finished.resolve('persisted');
    };
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/revoke') finished.resolve('revoked');
    };
    transport.enqueue(() => {
      refreshStarted.resolve();
      return refreshAnswer.promise;
    });
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await refreshStarted.promise;
    engine.dispose();
    await expect(request).rejects.toBeInstanceOf(AuthDisposedError);
    refreshAnswer.resolve(oauthTokenReply(ACCESS_SECRET_2_TOKEN, REFRESH_SECRET_2_TOKEN));

    const completion = await finished.promise;
    await refreshDeadlineCancelled.promise;
    await rotatedWriteDeadlineCancelled.promise;
    expect(ports.timer.pendingDelays).toEqual([]);

    expect(completion).toBe('persisted');
    expect(revokedTokens(transport)).toEqual([]);
    expect(ports.credentials.value).toContain(REFRESH_SECRET_2_TOKEN);
    expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
  });

  it('deletes a saved authorization transaction when disposal ends sign-in', async () => {
    const ports = testPorts(new ScriptedTransport());
    const browserOpened = new Deferred<void>();
    const deleteStarted = new Deferred<void>();
    const deleted = new Deferred<void>();
    ports.authBrowser.beforeOpen = () => browserOpened.resolve();
    ports.authBrowser.results.push(() => new Promise(() => undefined));
    ports.credentials.beforeDelete = () => {
      deleteStarted.resolve();
      return Promise.resolve();
    };
    ports.credentials.afterDelete = () => deleted.resolve();
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const signIn = engine.signIn();
    await browserOpened.promise;
    engine.dispose();

    await expect(signIn).resolves.toEqual({ kind: 'disposed' });
    await deleteStarted.promise;
    await deleted.promise;
    expect(ports.credentials.value).toBeUndefined();
  });
});

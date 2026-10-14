import { REFRESH_1_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD, TransportError } from '@app/sdk';
import type { SignOutOutcome } from '../../src';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  apiReply,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  testPorts,
} from '../support/support';

describe('abort listener faults', () => {
  it('settles the refresh deadline when a transport abort listener throws', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const refreshStarted = new Deferred<void>();
    const refreshAnswer = new Deferred<{ status: number; body: unknown }>();
    transport.onRequest = ({ path, body, signal }) => {
      if (
        path === '/api/oauth/token' &&
        typeof body === 'object' &&
        body !== null &&
        'grant_type' in body &&
        body.grant_type === 'refresh_token'
      ) {
        signal?.addEventListener('abort', () => {
          throw new Error('transport abort listener failed');
        });
        refreshStarted.resolve();
      }
    };
    transport.enqueue(
      failedApiReply(401, 'SESSION_INVALID'),
      () => refreshAnswer.promise,
      apiReply({ id: 'profile' }),
    );
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    await refreshStarted.promise;
    let timerError: unknown;
    try {
      ports.timer.fireDelay(15_000);
    } catch (error) {
      timerError = error;
    }
    refreshAnswer.resolve(oauthTokenReply('access-1', REFRESH_1_TOKEN));
    const result = await Promise.allSettled([request]);

    expect(timerError).toBeUndefined();
    expect(result[0]?.status).toBe('rejected');
    if (result[0]?.status === 'rejected') expect(result[0].reason).toBeInstanceOf(TransportError);
    expect(engine.snapshot.operation).toBe('none');
  });

  it('continues sign-out when a browser abort listener throws', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const browserOpened = new Deferred<void>();
    ports.authBrowser.beforeOpen = () => browserOpened.resolve();
    ports.authBrowser.results.push(() => new Promise(() => undefined));
    const signIn = engine.signIn();
    await browserOpened.promise;
    const signal = ports.authBrowser.opened[0]?.signal;
    expect(signal).toBeDefined();
    const listener = (): void => {
      throw new Error('browser abort listener failed');
    };
    signal?.addEventListener('abort', listener);

    let signOut: Promise<SignOutOutcome> | undefined;
    let synchronousError: unknown;
    try {
      signOut = engine.signOut();
    } catch (error) {
      synchronousError = error;
    }
    signal?.removeEventListener('abort', listener);
    const cleanup = signOut ?? engine.signOut();
    await Promise.all([signIn, cleanup]);

    expect(synchronousError).toBeUndefined();
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
  });
});

import { assert, describe, expect, it } from 'vitest';
import { type TransportSignal } from '@app/sdk';
import { BROWSER_AUTHORIZATION_TIMEOUT_MS } from '../../src/constants';
import { createAuthEngine } from '../support/engine';
import { revokedTokens } from '../support/tracking';
import {
  REFRESH_TOKEN,
  CONFIG,
  Deferred,
  ScriptedTransport,
  apiReply,
  acceptCode,
  redirectFrom,
  oauthTokenReply,
  testPorts,
  USER,
} from '../support/support';

describe('sign-in deadlines and cleanup', () => {
  it('ignores a browser deadline callback that fires after successful cancellation', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const browser = new Deferred<{ kind: 'cancelled' }>();
    const opened = new Deferred<string>();
    const exchangeStarted = new Deferred<void>();
    const exchangeAnswer = new Deferred<ReturnType<typeof oauthTokenReply>>();
    let lateDeadline: (() => void) | undefined;
    const schedule = ports.timer.after.bind(ports.timer);
    ports.timer.after = (milliseconds, callback) => {
      if (milliseconds === BROWSER_AUTHORIZATION_TIMEOUT_MS) {
        lateDeadline = callback;
        return () => undefined;
      }
      return schedule(milliseconds, callback);
    };
    ports.authBrowser.beforeOpen = (address) => opened.resolve(address);
    ports.authBrowser.results.push(() => browser.promise);
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/token') exchangeStarted.resolve();
    };
    transport.enqueue(() => exchangeAnswer.promise, apiReply(USER));
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const signIn = engine.signIn();
    const authorizeAddress = await opened.promise;
    const callback = ports.callbacks.deliver(
      redirectFrom(authorizeAddress, { code: 'timer-race' }),
    );
    await exchangeStarted.promise;
    lateDeadline?.();
    exchangeAnswer.resolve(oauthTokenReply());
    await callback;

    await expect(signIn).resolves.toMatchObject({ kind: 'signedIn' });
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
    expect(ports.timer.pending).toBe(0);
    browser.resolve({ kind: 'cancelled' });
  });

  it('keeps an accepted callback alive after the browser deadline', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const opened = new Deferred<void>();
    const exchangeResponse = new Deferred<ReturnType<typeof oauthTokenReply>>();
    const exchangeStarted = new Deferred<void>();
    const browserResult = new Deferred<{ kind: 'dismissed' }>();
    ports.authBrowser.beforeOpen = () => opened.resolve();
    ports.authBrowser.results.push(() => browserResult.promise);
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/token') exchangeStarted.resolve();
    };
    transport.enqueue(() => exchangeResponse.promise, apiReply(USER));

    const signIn = engine.signIn();
    await opened.promise;
    assert.isDefined(ports.authBrowser.opened[0]);
    const browserAddress = ports.authBrowser.opened[0].address;
    ports.callbacks.deliver(redirectFrom(browserAddress, { code: 'auth-code' }));
    await exchangeStarted.promise;
    expect(ports.timer.pending).toBe(1);
    expect(ports.timer.scheduled).toContain(15_000);
    exchangeResponse.resolve(oauthTokenReply());

    await expect(signIn).resolves.toMatchObject({ kind: 'signedIn' });
    expect(engine.snapshot.status).toBe('signedIn');
    expect(ports.timer.pending).toBe(0);
    browserResult.resolve({ kind: 'dismissed' });
  });

  it('surfaces failed transaction cleanup after browser cancellation', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    ports.credentials.beforeDelete = () => Promise.reject(new Error('storage unavailable'));

    const outcome = await engine.signIn();

    expect(outcome.kind).toBe('storageFailure');
    expect(engine.snapshot.status).toBe('storageBlocked');
    expect(ports.credentials.value).toContain('"transaction"');
    expect(ports.timer.pending).toBe(0);
  });

  it('ignores a return delivered after the browser has dismissed sign-in', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const deleteStarted = new Deferred<void>();
    const finishDelete = new Deferred<void>();
    ports.credentials.beforeDelete = () => {
      deleteStarted.resolve();
      return finishDelete.promise;
    };
    ports.authBrowser.results.push(() => ({ kind: 'dismissed' }));

    const signIn = engine.signIn();
    await deleteStarted.promise;
    const pendingBeforeLateLink = ports.timer.pending;
    const browserAddress = ports.authBrowser.opened[0]?.address;
    expect(browserAddress).toBeDefined();
    const delivered = new Deferred<void>();
    ports.callbacks.afterDelivery = () => delivered.resolve();
    await ports.callbacks.deliver(redirectFrom(browserAddress ?? '', { code: 'late-code' }));
    await delivered.promise;
    expect(ports.timer.pending).toBe(pendingBeforeLateLink);
    ports.callbacks.afterDelivery = undefined;
    finishDelete.resolve();

    const outcome = await signIn;

    expect(outcome.kind).toBe('dismissed');
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(0);
  });

  it('surfaces failed transaction cleanup when the authorization deadline expires', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const opened = new Deferred<void>();
    const browserResult = new Deferred<{ kind: 'dismissed' }>();
    ports.authBrowser.beforeOpen = () => opened.resolve();
    ports.authBrowser.results.push(() => browserResult.promise);
    ports.credentials.beforeDelete = () => Promise.reject(new Error('storage unavailable'));

    const signIn = engine.signIn();
    await opened.promise;
    ports.timer.fireAll();

    await expect(signIn).resolves.toMatchObject({ kind: 'storageFailure' });
    expect(engine.snapshot.status).toBe('storageBlocked');
    expect(ports.credentials.value).toContain('"transaction"');
    expect(ports.timer.pending).toBe(0);
    browserResult.resolve({ kind: 'dismissed' });
  });

  it('keeps the browser open through pending authorization and code lifetimes', async () => {
    const ports = testPorts(new ScriptedTransport());
    const opened = new Deferred<void>();
    ports.authBrowser.beforeOpen = () => opened.resolve();
    ports.authBrowser.results.push(() => new Promise(() => undefined));
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const signIn = engine.signIn();
    await opened.promise;

    expect(ports.timer.scheduled.at(-1)).toBe(360_000);
    ports.timer.fireDelay(360_000);

    await expect(signIn).resolves.toMatchObject({ kind: 'expired' });
  });

  it('settles browser setup when open throws before returning a promise', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    ports.authBrowser.open = () => {
      throw new Error('browser unavailable');
    };

    const outcome = await engine.signIn();

    expect(outcome).toMatchObject({ kind: 'browserFailure', reason: 'browser unavailable' });
    expect(engine.snapshot).toMatchObject({ status: 'signedOut', operation: 'none' });
    expect(ports.credentials.value).toBeUndefined();
  });

  it('bounds the PKCE random-byte call', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const random = new Deferred<Uint8Array>();
    const started = new Deferred<void>();
    let first = true;
    ports.crypto.randomBytes = (length) => {
      if (first) {
        first = false;
        started.resolve();
        return random.promise;
      }
      return Promise.resolve(new Uint8Array(length).fill(2));
    };
    const signIn = engine.signIn();
    await started.promise;
    const timerWasScheduled = ports.timer.pending > 0;
    if (timerWasScheduled) ports.timer.fireDelay(5_000);
    random.resolve(new Uint8Array(32).fill(1));
    const outcome = await signIn;

    expect(timerWasScheduled).toBe(true);
    expect(outcome.kind).toBe('cryptoFailure');
  });

  it('bounds the PKCE digest call', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const digest = new Deferred<Uint8Array>();
    const started = new Deferred<void>();
    ports.crypto.sha256 = () => {
      started.resolve();
      return digest.promise;
    };
    const signIn = engine.signIn();
    await started.promise;
    const timerWasScheduled = ports.timer.pending > 0;
    if (timerWasScheduled) ports.timer.fireDelay(5_000);
    digest.resolve(new Uint8Array(32).fill(3));
    const outcome = await signIn;

    expect(timerWasScheduled).toBe(true);
    expect(outcome.kind).toBe('cryptoFailure');
  });

  it('aborts an exchange that misses its deadline and settles sign-in', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const started = new Deferred<void>();
    const unanswered = new Deferred<ReturnType<typeof oauthTokenReply>>();
    let signal: TransportSignal | undefined;
    transport.onRequest = ({ path, signal: requestSignal }) => {
      if (path === '/api/oauth/token') {
        signal = requestSignal;
        started.resolve();
      }
    };
    transport.enqueue(() => unanswered.promise);
    acceptCode(ports.authBrowser);

    const signIn = engine.signIn();
    await started.promise;
    expect(ports.timer.scheduled).toContain(15_000);
    ports.timer.fireDelay(15_000);

    await expect(signIn).resolves.toMatchObject({ kind: 'transportFailure' });
    expect(signal?.aborted).toBe(true);
    expect(engine.snapshot.operation).toBe('none');
    expect(ports.timer.pending).toBe(0);
  });

  it('revokes a new session when the immediate profile read times out', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const profileStarted = new Deferred<void>();
    const profileAnswer = new Deferred<{ status: number; body: unknown }>();
    let profileSignal: TransportSignal | undefined;
    transport.onRequest = ({ path, signal }) => {
      if (path === '/api/user/profile') {
        profileSignal = signal;
        profileStarted.resolve();
      }
    };
    transport.enqueue(oauthTokenReply(), () => profileAnswer.promise);
    acceptCode(ports.authBrowser);
    const signIn = engine.signIn();
    await profileStarted.promise;

    expect(ports.timer.scheduled).toContain(15_000);
    ports.timer.fireDelay(15_000);

    await expect(signIn).resolves.toMatchObject({ kind: 'transportFailure' });
    expect(profileSignal?.aborted).toBe(true);
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(ports.timer.pending).toBe(0);
  });

  it('settles a credential write timeout without opening the browser', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const writeStarted = new Deferred<void>();
    ports.credentials.beforeReplace = () => {
      writeStarted.resolve();
      return new Promise(() => undefined);
    };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const signIn = engine.signIn();
    await writeStarted.promise;
    expect(ports.timer.scheduled).toContain(5_000);
    ports.timer.fireDelay(5_000);

    await expect(signIn).resolves.toMatchObject({ kind: 'storageFailure' });
    expect(ports.authBrowser.opened).toHaveLength(0);
    expect(engine.snapshot.status).toBe('storageBlocked');
    expect(ports.timer.pending).toBe(0);
  });
});

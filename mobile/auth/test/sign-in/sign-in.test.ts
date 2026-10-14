import { assert, describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import { revokedTokens } from '../support/tracking';
import { ApiError, OAuthError, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import {
  ACCESS_TOKEN,
  CONFIG,
  Deferred,
  REFRESH_TOKEN,
  ScriptedTransport,
  acceptCode,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  readQueryValues,
  redirectFrom,
  successUserReply,
  testPorts,
} from '../support/support';

function callbackFor(address: string, values: Record<string, string>): string {
  return redirectFrom(address, values);
}

describe('sign in', () => {
  it('reports a distinct outcome when a session is already signed in', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const sentBefore = transport.sent.length;
    const browsersBefore = ports.authBrowser.opened.length;

    const result = await engine.signIn();

    expect(result).toEqual({ kind: 'alreadySignedIn' });
    expect(engine.snapshot.status).toBe('signedIn');
    expect(transport.sent).toHaveLength(sentBefore);
    expect(ports.authBrowser.opened).toHaveLength(browsersBefore);
  });

  it('saves a PKCE transaction before opening the system browser and reads profile after token storage', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    let recordWasSavedAtOpen = false;
    ports.authBrowser.beforeOpen = () => {
      recordWasSavedAtOpen = ports.credentials.value !== undefined;
    };
    transport.enqueue(oauthTokenReply(), (request) => {
      expect(ports.credentials.value).toContain(REFRESH_TOKEN);
      expect(ports.credentials.value).not.toContain(ACCESS_TOKEN);
      expect(request.headers?.['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
      return Promise.resolve(successUserReply());
    });
    acceptCode(ports.authBrowser);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const result = await engine.signIn();

    expect(result.kind).toBe('signedIn');
    expect(recordWasSavedAtOpen).toBe(true);
    expect(ports.authBrowser.opened).toHaveLength(1);
    assert.isDefined(ports.authBrowser.opened[0]);
    const authorizeAddress = ports.authBrowser.opened[0].address;
    expect(authorizeAddress.startsWith('https://api.example.test/api/oauth/authorize?')).toBe(true);
    const authorize = readQueryValues(authorizeAddress);
    expect(authorize.get('response_type')).toBe('code');
    expect(authorize.get('client_id')).toBe(CONFIG.clientId);
    expect(authorize.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(authorize.get('code_challenge_method')).toBe('S256');
    expect(authorize.get('state')).toHaveLength(22);
    expect(ports.crypto.randomLengths).toEqual([32, 16, 16, 16]);
    expect(transport.sent.map(({ path }) => path)).toEqual([
      '/api/oauth/token',
      '/api/user/profile',
    ]);
    expect(engine.snapshot.status).toBe('signedIn');
    expect(Object.isFrozen(engine.snapshot.profile?.permissions)).toBe(true);
  });

  it('does not open the browser when the transaction cannot be saved', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.credentials.beforeReplace = () => Promise.reject(new Error('storage failed'));
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const result = await engine.signIn();

    expect(result.kind).toBe('storageFailure');
    expect(ports.authBrowser.opened).toHaveLength(0);
  });

  it.each([
    ['cancelled', { kind: 'cancelled' }, 'cancelled'],
    ['dismissed', { kind: 'dismissed' }, 'dismissed'],
  ] as const)('preserves the distinct browser result %s', async (_name, browserResult, outcome) => {
    const ports = testPorts(new ScriptedTransport());
    ports.authBrowser.results.push(() => browserResult);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const result = await engine.signIn();

    expect(result.kind).toBe(outcome);
    expect(ports.credentials.value).toBeUndefined();
    expect(engine.snapshot.status).toBe('signedOut');
  });

  it('returns the same pending promise when sign in is already running', async () => {
    const ports = testPorts(new ScriptedTransport());
    const browser = new Deferred<{ kind: 'cancelled' }>();
    ports.authBrowser.results.push(() => browser.promise);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const first = engine.signIn();
    const second = engine.signIn();

    expect(second).toBe(first);
    browser.resolve({ kind: 'cancelled' });
    await first;
  });

  it('shares the pending sign-in promise with a reentrant subscriber', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    let nested: Promise<{ kind: string }> | undefined;
    engine.subscribe((snapshot) => {
      if (snapshot.operation === 'authorizing' && !nested) nested = engine.signIn();
    });

    const first = engine.signIn();

    expect(nested).toBe(first);
    await first;
  });

  it('keeps OAuth, throttling, and transport failures distinct', async () => {
    const cases = [
      {
        step: { status: 400, body: { error: 'invalid_grant' } },
        expected: 'oauthFailure',
        errorType: OAuthError,
      },
      {
        step: failedApiReply(429, 'RATE_LIMIT_EXCEEDED'),
        expected: 'throttled',
        errorType: ApiError,
      },
      {
        step: new TransportError('no_response'),
        expected: 'transportFailure',
        errorType: TransportError,
      },
      {
        step: new TransportError(TRANSPORT_FAILURE.ABORTED),
        expected: 'aborted',
        errorType: TransportError,
      },
    ] as const;
    for (const testCase of cases) {
      const transport = new ScriptedTransport();
      transport.enqueue(testCase.step);
      const ports = testPorts(transport);
      acceptCode(ports.authBrowser);
      const engine = createAuthEngine(CONFIG, ports);
      await engine.restore();

      const result = await engine.signIn();

      expect(result.kind).toBe(testCase.expected);
      if ('error' in result) expect(result.error).toBeInstanceOf(testCase.errorType);
      expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    }
  });

  it('keeps a browser failure distinct from user cancellation and system dismissal', async () => {
    const ports = testPorts(new ScriptedTransport());
    ports.authBrowser.results.push(() => ({ kind: 'failed', reason: 'browser unavailable' }));
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const result = await engine.signIn();

    expect(result.kind).toBe('browserFailure');
    expect(ports.credentials.value).toBeUndefined();
  });

  it('clears an expired browser transaction and cancels its deadline', async () => {
    const ports = testPorts(new ScriptedTransport());
    const browserOpened = new Deferred<void>();
    const browser = new Deferred<{ kind: 'cancelled' }>();
    ports.authBrowser.beforeOpen = () => browserOpened.resolve();
    ports.authBrowser.results.push(() => browser.promise);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const pending = engine.signIn();
    await browserOpened.promise;
    expect(ports.timer.pending).toBe(1);
    ports.timer.fireAll();

    await expect(pending).resolves.toEqual({ kind: 'expired' });
    expect(ports.credentials.value).toBeUndefined();
    expect(ports.timer.pending).toBe(0);
  });

  it('ignores a duplicate callback while the first exchange is pending', async () => {
    const transport = new ScriptedTransport();
    const exchange = new Deferred<ReturnType<typeof oauthTokenReply>>();
    const exchangeStarted = new Deferred<void>();
    transport.enqueue(() => exchange.promise, successUserReply());
    const ports = testPorts(transport);
    acceptCode(ports.authBrowser, 'once');
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    let transactionWasConsumedBeforeExchange = false;
    transport.onRequest = ({ path }) => {
      if (path !== '/api/oauth/token') return;
      transactionWasConsumedBeforeExchange = !ports.credentials.value?.includes('"transaction"');
      assert.isDefined(ports.authBrowser.opened[0]);
      const callback = callbackFor(ports.authBrowser.opened[0].address, { code: 'once' });
      ports.callbacks.deliver(callback);
      exchangeStarted.resolve();
    };

    const pending = engine.signIn();
    await exchangeStarted.promise;
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    expect(transactionWasConsumedBeforeExchange).toBe(true);
    exchange.resolve(oauthTokenReply());

    await expect(pending).resolves.toMatchObject({ kind: 'signedIn' });
  });

  it('shares an in-progress exchange when a second callback arrives after consumption', async () => {
    const transport = new ScriptedTransport();
    transport.enqueue(oauthTokenReply(), successUserReply());
    const ports = testPorts(transport);
    const browser = new Deferred<{ kind: 'cancelled' }>();
    const browserOpened = new Deferred<string>();
    ports.authBrowser.results.push(() => browser.promise);
    ports.authBrowser.beforeOpen = (address) => browserOpened.resolve(address);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const pending = engine.signIn();
    const callback = callbackFor(await browserOpened.promise, { code: 'once' });
    let deliveredDuplicate = false;
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/token' && !deliveredDuplicate) {
        deliveredDuplicate = true;
        ports.callbacks.deliver(callback);
      }
    };

    ports.callbacks.deliver(callback);

    await expect(pending).resolves.toMatchObject({ kind: 'signedIn' });
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
  });

  it('exchanges a saved transaction from the cold-start address', async () => {
    const savedTransport = new ScriptedTransport();
    const savedPorts = testPorts(savedTransport);
    const browserPending = new Deferred<{ kind: 'cancelled' }>();
    const browserOpened = new Deferred<string>();
    savedPorts.authBrowser.results.push(() => browserPending.promise);
    savedPorts.authBrowser.beforeOpen = (address) => browserOpened.resolve(address);
    const first = createAuthEngine(CONFIG, savedPorts);
    await first.restore();
    const firstSignIn = first.signIn();
    const callback = callbackFor(await browserOpened.promise, { code: 'cold-code' });
    const savedTransaction = savedPorts.credentials.value;
    await first.signOut();
    await expect(firstSignIn).resolves.toEqual({ kind: 'signedOut' });
    savedPorts.credentials.value = savedTransaction;
    browserPending.resolve({ kind: 'cancelled' });

    const transport = new ScriptedTransport();
    transport.enqueue(oauthTokenReply(), successUserReply());
    const ports = testPorts(transport);
    ports.credentials = savedPorts.credentials;
    ports.install = savedPorts.install;
    ports.callbacks.initial = callback;
    const restored = createAuthEngine(CONFIG, ports);
    await restored.restore();

    expect(restored.snapshot.status).toBe('signedIn');
    expect(transport.sent.map(({ path }) => path)).toEqual([
      '/api/oauth/token',
      '/api/user/profile',
    ]);
  });

  it('deletes and ignores an expired cold-start transaction', async () => {
    const savedPorts = testPorts(new ScriptedTransport());
    const browserPending = new Deferred<{ kind: 'cancelled' }>();
    const browserOpened = new Deferred<string>();
    savedPorts.authBrowser.results.push(() => browserPending.promise);
    savedPorts.authBrowser.beforeOpen = (address) => browserOpened.resolve(address);
    const first = createAuthEngine(CONFIG, savedPorts);
    await first.restore();
    const firstSignIn = first.signIn();
    const callback = callbackFor(await browserOpened.promise, { code: 'late-code' });
    const savedTransaction = savedPorts.credentials.value;
    await first.signOut();
    await expect(firstSignIn).resolves.toEqual({ kind: 'signedOut' });
    savedPorts.credentials.value = savedTransaction;
    browserPending.resolve({ kind: 'cancelled' });

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials = savedPorts.credentials;
    ports.install = savedPorts.install;
    ports.clock.wall += 360_001;
    ports.callbacks.initial = callback;
    const restored = createAuthEngine(CONFIG, ports);
    await restored.restore();

    expect(restored.snapshot.status).toBe('signedOut');
    expect(ports.credentials.value).toBeUndefined();
    expect(transport.sent).toHaveLength(0);
  });

  it('revokes a token response that arrives after sign out', async () => {
    const transport = new ScriptedTransport();
    const exchange = new Deferred<ReturnType<typeof oauthTokenReply>>();
    const exchangeStarted = new Deferred<void>();
    transport.enqueue(() => exchange.promise, { status: 200, body: {} });
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/token') exchangeStarted.resolve();
    };
    const ports = testPorts(transport);
    acceptCode(ports.authBrowser);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const pending = engine.signIn();
    await exchangeStarted.promise;
    const signOut = engine.signOut();
    exchange.resolve(oauthTokenReply(ACCESS_TOKEN, 'late-refresh'));
    await Promise.all([pending, signOut]);

    expect(ports.credentials.value).toBeUndefined();
    expect(revokedTokens(transport)).toEqual(['late-refresh']);
    expect(engine.snapshot.status).toBe('signedOut');
  });
});

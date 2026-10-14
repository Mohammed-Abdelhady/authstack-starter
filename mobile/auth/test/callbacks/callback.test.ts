import { assert, describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  oauthTokenReply,
  readQueryValues,
  redirectFrom,
  successUserReply,
  testPorts,
} from '../support/support';

function callbackFor(address: string, values: Record<string, string>): string {
  return redirectFrom(address, values);
}

describe('authorization returns', () => {
  it('accepts the exact loopback callback on the shell selected port', async () => {
    const redirectUri = 'http://127.0.0.1:49152/callback';
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const browser = new Deferred<{ kind: 'cancelled' }>();
    const opened = new Deferred<string>();
    ports.authBrowser.results.push(() => browser.promise);
    ports.authBrowser.beforeOpen = (address) => opened.resolve(address);
    transport.enqueue(oauthTokenReply(), successUserReply());
    const engine = createAuthEngine({ ...CONFIG, redirectUri }, ports);
    await engine.restore();
    const signIn = engine.signIn();
    const authorizeAddress = await opened.promise;
    const state = readQueryValues(authorizeAddress).get('state');

    const wrongPortDelivered = new Deferred<void>();
    ports.callbacks.afterDelivery = () => wrongPortDelivered.resolve();
    ports.callbacks.deliver(`http://127.0.0.1:49153/callback?code=wrong-port&state=${state}`);
    await wrongPortDelivered.promise;
    ports.callbacks.afterDelivery = undefined;
    expect(engine.snapshot.operation).toBe('authorizing');
    ports.callbacks.deliver(`http://127.0.0.1:49152/callback?code=right-port&state=${state}`);

    await expect(signIn).resolves.toMatchObject({ kind: 'signedIn' });
    const exchange = transport.sent.find(({ path }) => path === '/api/oauth/token');
    expect(exchange?.body).toMatchObject({ code: 'right-port' });
    expect(exchange?.body).toMatchObject({ redirect_uri: 'http://127.0.0.1:49152/callback' });
    browser.resolve({ kind: 'cancelled' });
  });

  it('deletes and ignores a return that expires while the browser is open', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const browser = new Deferred<{ kind: 'cancelled' }>();
    const browserOpened = new Deferred<string>();
    ports.authBrowser.results.push(() => browser.promise);
    ports.authBrowser.beforeOpen = (address) => browserOpened.resolve(address);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const pending = engine.signIn();
    const authorizeAddress = await browserOpened.promise;
    ports.clock.jumpWall(360_001);
    ports.callbacks.deliver(callbackFor(authorizeAddress, { code: 'late-code' }));

    await expect(pending).resolves.toEqual({ kind: 'expired' });
    expect(ports.credentials.value).toBeUndefined();
    expect(transport.sent).toHaveLength(0);
    expect(ports.timer.pending).toBe(0);
  });

  it('settles expired callback cleanup that races browser dismissal', async () => {
    const ports = testPorts(new ScriptedTransport());
    const browserResult = new Deferred<{ kind: 'dismissed' }>();
    const deleteStarted = new Deferred<void>();
    const finishDelete = new Deferred<void>();
    ports.authBrowser.results.push(() => browserResult.promise);
    ports.credentials.beforeDelete = () => {
      deleteStarted.resolve();
      return finishDelete.promise;
    };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const opened = new Deferred<void>();
    ports.authBrowser.beforeOpen = () => opened.resolve();
    const signIn = engine.signIn();
    await opened.promise;
    ports.clock.jumpWall(360_001);
    assert.isDefined(ports.authBrowser.opened[0]);
    const state = readQueryValues(ports.authBrowser.opened[0].address).get('state');
    if (!state) throw new Error('authorization state was missing');
    ports.callbacks.deliver(`${CONFIG.redirectUri}?code=late&state=${state}`);
    await deleteStarted.promise;
    browserResult.resolve({ kind: 'dismissed' });
    finishDelete.resolve();

    await expect(signIn).resolves.toMatchObject({ kind: 'expired' });
    expect(engine.snapshot.operation).toBe('none');
  });

  it('keeps waiting after a foreign link and exchanges the configured return once', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const browserResult = new Deferred<{ kind: 'dismissed' }>();
    const opened = new Deferred<void>();
    ports.authBrowser.results.push(() => browserResult.promise);
    ports.authBrowser.beforeOpen = () => opened.resolve();
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    transport.enqueue(oauthTokenReply(), successUserReply());

    const signIn = engine.signIn();
    await opened.promise;
    const foreignDelivered = new Deferred<void>();
    ports.callbacks.afterDelivery = () => foreignDelivered.resolve();
    ports.callbacks.deliver('sampleapp://products/42');
    await foreignDelivered.promise;
    ports.callbacks.afterDelivery = undefined;
    expect(engine.snapshot.operation).toBe('authorizing');
    expect(ports.credentials.value).toContain('"transaction"');

    assert.isDefined(ports.authBrowser.opened[0]);
    const authorizeAddress = ports.authBrowser.opened[0].address;
    ports.callbacks.deliver(redirectFrom(authorizeAddress, { code: 'auth-code' }));
    await expect(signIn).resolves.toMatchObject({ kind: 'signedIn' });
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    browserResult.resolve({ kind: 'dismissed' });
  });

  it.each([
    ['code', { code: 'c', state: 'wrong-state' }],
    ['error', { error: 'access_denied', state: 'wrong-state' }],
  ])('ignores a wrong state on a %s return and keeps waiting', async (_name, params) => {
    await expectIgnoredReturn((address) => callbackFor(address, params));
  });

  it.each([
    ['fragment', (url: string) => `${url}#fragment`],
    [
      'user info',
      (url: string) => `sampleapp://person@auth/callback${url.slice(url.indexOf('?'))}`,
    ],
    [
      'repeated parameter',
      (url: string) =>
        `${CONFIG.redirectUri}?code=a&code=b&state=${readQueryValues(url).get('state')}`,
    ],
    [
      'different port',
      (url: string) =>
        `sampleapp://auth:81/callback?code=c&state=${readQueryValues(url).get('state')}`,
    ],
    [
      'different path',
      (url: string) => `sampleapp://auth/other?code=c&state=${readQueryValues(url).get('state')}`,
    ],
    [
      'different host',
      (url: string) =>
        `sampleapp://other/callback?code=c&state=${readQueryValues(url).get('state')}`,
    ],
    [
      'different scheme',
      (url: string) =>
        `otherscheme://auth/callback?code=c&state=${readQueryValues(url).get('state')}`,
    ],
    [
      'repeated state',
      (url: string) =>
        `${CONFIG.redirectUri}?code=c&state=${readQueryValues(url).get('state')}&state=again`,
    ],
    ['missing state', () => `${CONFIG.redirectUri}?code=c&extra=value`],
    ['extra parameter', (url: string) => `${url}&extra=value`],
    [
      'both code and error',
      (url: string) =>
        `${CONFIG.redirectUri}?code=c&error=access_denied&state=${readQueryValues(url).get('state')}`,
    ],
  ])('ignores a return with a %s and keeps waiting', async (_name, makeUrl) =>
    expectIgnoredReturn((address) => makeUrl(callbackFor(address, { code: 'c' }))),
  );

  it('consumes a valid denial only after checking its state', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.authBrowser.results.push((address) => ({
      kind: 'redirect',
      url: callbackFor(address, { error: 'access_denied' }),
    }));
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    const result = await engine.signIn();

    expect(result.kind).toBe('authorizationDenied');
    expect(ports.credentials.value).toBeUndefined();
    expect(transport.sent).toHaveLength(0);
  });

  it('accepts a warm link after restore read no cold-start address', async () => {
    const firstPorts = testPorts(new ScriptedTransport());
    const browser = new Deferred<{ kind: 'cancelled' }>();
    const browserOpened = new Deferred<void>();
    firstPorts.authBrowser.results.push(() => browser.promise);
    firstPorts.authBrowser.beforeOpen = () => browserOpened.resolve();
    const first = createAuthEngine(CONFIG, firstPorts);
    await first.restore();
    const signIn = first.signIn();
    await browserOpened.promise;
    const authorizeAddress = firstPorts.authBrowser.opened[0]?.address;
    if (!authorizeAddress) throw new Error('authorize address was not opened');
    const savedRecord = firstPorts.credentials.value;
    const transactionDeleted = new Deferred<void>();
    firstPorts.credentials.afterDelete = () => transactionDeleted.resolve();
    first.dispose();
    await expect(signIn).resolves.toEqual({ kind: 'disposed' });
    await transactionDeleted.promise;

    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    ports.credentials = firstPorts.credentials;
    ports.credentials.value = savedRecord;
    ports.install = firstPorts.install;
    transport.enqueue(oauthTokenReply(), successUserReply());
    const restarted = createAuthEngine(CONFIG, ports);
    await expect(restarted.restore()).resolves.toEqual({ kind: 'restored', status: 'signedOut' });

    await ports.callbacks.deliver(callbackFor(authorizeAddress, { code: 'cold-return-code' }));

    expect(restarted.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
    expect(transport.sent.find(({ path }) => path === '/api/oauth/token')?.body).toMatchObject({
      code: 'cold-return-code',
    });
  });

  it('ignores a callback delivered after disposal', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const browser = new Deferred<{ kind: 'cancelled' }>();
    const opened = new Deferred<string>();
    ports.authBrowser.results.push(() => browser.promise);
    ports.authBrowser.beforeOpen = (address) => opened.resolve(address);
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const signIn = engine.signIn();
    const authorizeAddress = await opened.promise;

    engine.dispose();
    await expect(signIn).resolves.toEqual({ kind: 'disposed' });
    await ports.callbacks.deliver(callbackFor(authorizeAddress, { code: 'after-dispose' }));

    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(0);
    expect(ports.callbacks.listeners.size).toBe(0);
  });

  it('ignores a duplicate callback after the first exchange completed', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const browser = new Deferred<{ kind: 'cancelled' }>();
    const opened = new Deferred<string>();
    ports.authBrowser.results.push(() => browser.promise);
    ports.authBrowser.beforeOpen = (address) => opened.resolve(address);
    transport.enqueue(oauthTokenReply(), successUserReply());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    const signIn = engine.signIn();
    const authorizeAddress = await opened.promise;
    const callback = callbackFor(authorizeAddress, { code: 'once-only' });
    await ports.callbacks.deliver(callback);
    await expect(signIn).resolves.toMatchObject({ kind: 'signedIn' });

    await ports.callbacks.deliver(callback);

    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
    browser.resolve({ kind: 'cancelled' });
  });
});

async function expectIgnoredReturn(makeUrl: (address: string) => string): Promise<void> {
  const ports = testPorts(new ScriptedTransport());
  const browser = new Deferred<{ kind: 'cancelled' }>();
  const opened = new Deferred<string>();
  ports.authBrowser.results.push(() => browser.promise);
  ports.authBrowser.beforeOpen = (address) => opened.resolve(address);
  const engine = createAuthEngine(CONFIG, ports);
  await engine.restore();
  const pending = engine.signIn();
  const address = await opened.promise;
  const delivered = new Deferred<void>();
  ports.callbacks.afterDelivery = () => delivered.resolve();
  ports.callbacks.deliver(makeUrl(address));
  await delivered.promise;
  ports.callbacks.afterDelivery = undefined;

  expect(engine.snapshot.operation).toBe('authorizing');
  expect(ports.credentials.value).toContain('"transaction"');
  ports.timer.fireAll();
  await expect(pending).resolves.toMatchObject({ kind: 'expired' });
  expect(ports.credentials.value).toBeUndefined();
  browser.resolve({ kind: 'cancelled' });
}

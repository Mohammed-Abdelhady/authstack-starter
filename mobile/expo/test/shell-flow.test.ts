import {
  FAKE_SHA256,
  FakeCrypto,
  FakeLinking,
  FakeMarkerFile,
  FakeSecureStore,
  FakeServer,
  FakeTime,
  FakeUuid,
  FakeWebBrowser,
  SERVER_RETURN_ADDRESS,
  SERVER_USER,
} from '@app/native-adapters/testing';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/logic/resolve-config';
import { createShellAuth, type ShellAuth } from '../src/shell';

/** Written by hand: prefix, escaped client id, environment. */
const RECORD_KEY = 'auth.com_002eexample_002emobile.development';
const KEYCHAIN_OPTIONS = { keychainAccessible: 4 };
const LOCKED = 'User interaction is not allowed.';

/** One device: what survives when the app is killed and started again. */
function device() {
  const store = new FakeSecureStore();
  const marker = new FakeMarkerFile();
  const recordMarker = new FakeMarkerFile();
  const server = new FakeServer();
  const uuid = new FakeUuid();
  const browser = new FakeWebBrowser();
  browser.respond = (url) => ({ type: 'success', url: server.authorize(url) });

  const start = (linking = new FakeLinking(null)): ShellAuth =>
    createShellAuth(
      {
        secureStore: store,
        keychainOptions: KEYCHAIN_OPTIONS,
        webBrowser: browser,
        crypto: new FakeCrypto(),
        sha256Algorithm: FAKE_SHA256,
        linking,
        installMarker: marker,
        recordMarker,
        uuid,
        clock: new FakeTime(),
        timers: new FakeTime(),
        http: server,
      },
      {
        configuration: resolveConfig({
          apiOrigin: undefined,
          development: true,
          scheme: 'com.example.mobile',
        }),
        ephemeralBrowserSession: true,
      },
    );
  return { store, marker, recordMarker, server, browser, start };
}

/** Leaves the next browser session open and resolves with its address once it is opened. */
function sessionLeftOpen(browser: FakeWebBrowser): Promise<string> {
  const open = browser.openAuthSessionAsync.bind(browser);
  browser.respond = undefined;
  return new Promise<string>((resolve) => {
    browser.openAuthSessionAsync = (url, redirectUrl, options) => {
      resolve(url);
      return open(url, redirectUrl, options);
    };
  });
}

async function signedInDevice() {
  const parts = device();
  const app = parts.start();
  await app.engine.restore();
  const outcome = await app.engine.signIn();
  return { ...parts, app, outcome };
}

describe('the shell from sign-in to sign-out, over fakes of the native modules', () => {
  it('signs in from a cold app through the browser and stores one record', async () => {
    const { outcome, app, browser, store, server } = await signedInDevice();

    expect(outcome.kind).toBe('signedIn');
    expect(app.engine.snapshot.status).toBe('signedIn');
    expect(app.engine.snapshot.profile?.email).toBe('person@example.test');
    expect(browser.opened).toHaveLength(1);
    expect(browser.opened[0]?.redirectUrl).toBe(SERVER_RETURN_ADDRESS);
    expect(browser.opened[0]?.options).toEqual({ preferEphemeralSession: true });
    expect(store.items.has(RECORD_KEY)).toBe(true);
    expect(server.requests.every(({ credentials }) => credentials === 'omit')).toBe(true);
  });

  it('restores the session after a cold start without the browser', async () => {
    const { start, browser } = await signedInDevice();

    const relaunched = start();
    const outcome = await relaunched.engine.restore();

    expect(outcome).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(browser.opened).toHaveLength(1);
  });

  it('refreshes once before the first request of a restored session', async () => {
    const { start, server } = await signedInDevice();
    const relaunched = start();
    await relaunched.engine.restore();

    const profile = await relaunched.client.profile.get();

    expect(profile).toEqual(SERVER_USER);
    expect(server.refreshes).toBe(1);
    expect(relaunched.debug.refreshTokenRequests()).toBe(1);
  });

  it('refreshes once when the app asks, and the profile loads on the new token', async () => {
    const { app, server } = await signedInDevice();
    await app.client.profile.get();
    expect(server.refreshes).toBe(0);

    const outcome = await app.engine.refresh();
    const profile = await app.client.profile.get();

    expect(outcome).toEqual({ kind: 'refreshed' });
    expect(profile.email).toBe('person@example.test');
    expect(server.refreshes).toBe(1);
    expect(app.debug.refreshTokenRequests()).toBe(1);
  });

  it('keeps the rotated token, so a second cold start can still refresh', async () => {
    const { start, server } = await signedInDevice();
    const second = start();
    await second.engine.restore();
    await second.client.profile.get();

    const third = start();
    await third.engine.restore();

    expect((await third.client.profile.get()).id).toBe('user-1');
    expect(server.refreshes).toBe(2);
  });

  it('signs out: the record is gone and the server revoked the current token', async () => {
    const { app, store, server } = await signedInDevice();

    const outcome = await app.engine.signOut();

    expect(outcome).toEqual({ kind: 'signedOut', revocation: 'revoked' });
    expect(app.engine.snapshot.status).toBe('signedOut');
    expect(store.items.has(RECORD_KEY)).toBe(false);
    expect(server.revoked).toEqual(['refresh-1']);
  });

  it('leaves no session and no error state when the person closes the browser', async () => {
    const { start, browser, store } = device();
    browser.respond = () => ({ type: 'cancel' });
    const app = start();
    await app.engine.restore();

    const outcome = await app.engine.signIn();

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(app.engine.snapshot).toEqual({ status: 'signedOut', operation: 'none' });
    expect(store.items.has(RECORD_KEY)).toBe(false);
  });

  it('opens one browser for two taps on sign in', async () => {
    const { start, browser } = device();
    const app = start();
    await app.engine.restore();

    await Promise.all([app.engine.signIn(), app.engine.signIn()]);

    expect(browser.opened).toHaveLength(1);
  });

  it('reports a locked keychain as locked and keeps the record', async () => {
    const { start, store } = await signedInDevice();
    store.readFailure = 'User interaction is not allowed.';
    const relaunched = start();

    const outcome = await relaunched.engine.restore();

    // The install id lives in the same keychain and is read first.
    expect(outcome).toEqual({ kind: 'storageBlocked', reason: 'locked' });
    expect(relaunched.engine.snapshot.status).toBe('storageBlocked');
    expect(store.items.has(RECORD_KEY)).toBe(true);
  });

  it('says the record itself is locked when only that item cannot be read', async () => {
    const { start, store } = await signedInDevice();
    store.readFailure = 'User interaction is not allowed.';
    store.readFailureKey = RECORD_KEY;
    const relaunched = start();

    const outcome = await relaunched.engine.restore();

    expect(outcome).toEqual({ kind: 'storageBlocked', reason: 'locked' });
    expect(relaunched.engine.snapshot.status).toBe('storageBlocked');
    expect(store.items.has(RECORD_KEY)).toBe(true);
  });

  it('restores once the keychain can be read again', async () => {
    const { start, store } = await signedInDevice();
    store.readFailure = 'User interaction is not allowed.';
    const relaunched = start();
    await relaunched.engine.restore();
    store.readFailure = undefined;

    expect(await relaunched.engine.restore()).toEqual({ kind: 'restored', status: 'signedIn' });
  });

  it('does not use a record the keychain kept from an earlier install', async () => {
    const { start, marker, store, browser } = await signedInDevice();
    marker.present = false;
    const reinstalled = start();

    const outcome = await reinstalled.engine.restore();

    expect(outcome).toEqual({ kind: 'restored', status: 'signedOut' });
    expect(store.items.has(RECORD_KEY)).toBe(false);
    expect(browser.opened).toHaveLength(1);
  });
});

describe('the shell when the platform gets in the way', () => {
  it('signs out with a reason when the platform dropped the record on its own', async () => {
    const { start, store, recordMarker } = await signedInDevice();
    store.discard(RECORD_KEY);
    const relaunched = start();

    const outcome = await relaunched.engine.restore();

    expect(outcome).toEqual({ kind: 'restored', status: 'signedOut' });
    expect(relaunched.engine.snapshot).toEqual({
      status: 'signedOut',
      operation: 'none',
      reason: 'invalidRecord',
    });
    expect(recordMarker.present).toBe(false);
  });

  it('holds a rotated token while the keychain is locked and saves it after unlock', async () => {
    const { app, start, store, server } = await signedInDevice();
    const send = server.fetch.bind(server);
    // The device locks while the refresh is on its way, after the marker was saved.
    server.fetch = (address, init) => {
      if (address.endsWith('/api/oauth/token')) store.writeFailure = LOCKED;
      return send(address, init);
    };

    const refreshed = await app.engine.refresh();

    expect(refreshed).toEqual({ kind: 'refreshed' });
    expect(app.engine.snapshot.status).toBe('signedIn');
    expect(app.engine.snapshot.warning).toBe('storageBlocked');
    expect(app.engine.snapshot.reason).toBe('storageLocked');
    expect(store.items.get(RECORD_KEY)).toContain('"refreshToken":"refresh-1"');

    server.fetch = send;
    store.writeFailure = undefined;
    const restored = await app.engine.restore();

    expect(restored).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(app.engine.snapshot.warning).toBeUndefined();
    expect(store.items.get(RECORD_KEY)).toContain('"refreshToken":"refresh-2"');
    expect(server.refreshes).toBe(1);

    const relaunched = start();
    await relaunched.engine.restore();
    expect((await relaunched.client.profile.get()).id).toBe('user-1');
    expect(server.refreshes).toBe(2);
  });

  it('reports a refresh the locked keychain stopped before it was sent', async () => {
    const { app, store, server } = await signedInDevice();
    store.writeFailure = LOCKED;

    const outcome = await app.engine.refresh();

    expect(outcome.kind).toBe('failed');
    expect(outcome).toMatchObject({
      error: { operation: 'credentials.replace', condition: 'locked' },
    });
    expect(server.refreshes).toBe(0);
    expect(app.engine.snapshot.status).toBe('signedIn');
  });

  it('finishes a sign-in that returned to a cold app whose launch read failed once', async () => {
    const { start, browser, server } = device();
    const opened = sessionLeftOpen(browser);
    const first = start();
    await first.engine.restore();
    void first.engine.signIn();
    const link = server.authorize(await opened);
    const linking = new FakeLinking(link);
    linking.failingInitialReads = 1;
    const relaunched = start(linking);

    const blind = await relaunched.engine.restore();

    expect(blind).toEqual({ kind: 'restored', status: 'signedOut' });
    expect(server.requests).toHaveLength(0);

    const second = await relaunched.engine.restore();

    expect(second).toEqual({ kind: 'restored', status: 'signedIn' });
    expect(linking.initialReads).toBe(2);
    expect(server.requests.map(({ path }) => path)).toEqual([
      '/api/oauth/token',
      '/api/user/profile',
    ]);
    expect(browser.opened).toHaveLength(1);
  });
});

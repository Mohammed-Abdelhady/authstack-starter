import { describe, expect, it } from 'vitest';
import { createNativePorts, type NativePortSettings } from '../src';
import { TestAbort } from './support/abort';
import {
  FAKE_SHA256,
  FakeCrypto,
  FakeLinking,
  FakeMarkerFile,
  FakeTime,
  FakeUuid,
  FakeWebBrowser,
} from './support/fake-modules';
import { FakeSecureStore } from './support/fake-store';

const SETTINGS: NativePortSettings = {
  clientId: 'com.example.mobile',
  environment: 'staging',
  ephemeralBrowserSession: false,
};
const RETURN_ADDRESS = 'com.example.mobile://oauth/callback';
/** Written by hand: prefix, escaped client id, environment. */
const RECORD_KEY = 'auth.com_002eexample_002emobile.staging';
const INSTALL_KEY = 'app.install-id';
const LINK = 'com.example.mobile://oauth/callback?code=A&state=s1';

function device() {
  const store = new FakeSecureStore();
  const browser = new FakeWebBrowser();
  const linking = new FakeLinking(LINK);
  const time = new FakeTime();
  const marker = new FakeMarkerFile();
  const recordMarker = new FakeMarkerFile();
  // A shell names the record marker after the client and environment, so other settings get another file.
  const markerFor = (settings: NativePortSettings): FakeMarkerFile =>
    settings.clientId === SETTINGS.clientId && settings.environment === SETTINGS.environment
      ? recordMarker
      : new FakeMarkerFile();
  const build = (settings: NativePortSettings = SETTINGS) =>
    createNativePorts(
      {
        secureStore: store,
        keychainOptions: { keychainAccessible: 4 },
        webBrowser: browser,
        crypto: new FakeCrypto(),
        sha256Algorithm: FAKE_SHA256,
        linking,
        installMarker: marker,
        recordMarker: markerFor(settings),
        uuid: new FakeUuid(),
        clock: time,
        timers: time,
      },
      settings,
    );
  return { store, browser, linking, time, marker, recordMarker, build };
}

describe('the one factory a shell calls', () => {
  it('keeps the record under a key named by client id and environment', async () => {
    const { store, build } = device();

    await build().credentials.replace('record');

    expect([...store.items.keys()]).toEqual([RECORD_KEY]);
    expect(store.calls).toEqual([
      { call: 'set', key: RECORD_KEY, options: { keychainAccessible: 4 } },
    ]);
  });

  it.each([
    [{ ...SETTINGS, environment: 'production' }],
    [{ ...SETTINGS, clientId: 'com.example.other' }],
  ])('hides the record from a build with other settings: %j', async (other) => {
    const { build } = device();
    await build().credentials.replace('record');

    expect(await build(other).credentials.read()).toEqual({ kind: 'missing' });
    await build(other).credentials.delete();

    expect(await build().credentials.read()).toEqual({ kind: 'found', value: 'record' });
  });

  it('keeps the install id apart from the record, with the same keychain options', async () => {
    const { store, build } = device();
    const ports = build();
    await ports.credentials.replace('record');

    const identity = await ports.install.identity();
    await ports.credentials.delete();

    expect(identity).toEqual({ kind: 'found', id: '00000000-0000-4000-8000-000000000001' });
    expect(store.items.get(INSTALL_KEY)).toBe('00000000-0000-4000-8000-000000000001');
    expect(store.calls.at(1)).toEqual({
      call: 'set',
      key: INSTALL_KEY,
      options: { keychainAccessible: 4 },
    });
  });

  it('marks the record in its own file and leaves the install marker alone', async () => {
    const { store, marker, recordMarker, build } = device();
    const ports = build();

    await ports.credentials.replace('record');

    expect(recordMarker.present).toBe(true);
    expect(marker.present).toBe(false);
    store.discard(RECORD_KEY);
    expect(await ports.credentials.read()).toEqual({ kind: 'corrupt' });
  });

  it.each([[true], [false]])(
    'opens the browser with the return address it is given and ephemeral set to %j',
    async (ephemeralBrowserSession) => {
      const { browser, build } = device();
      browser.steps.push({ kind: 'resolve', result: { type: 'cancel' } });

      await build({ ...SETTINGS, ephemeralBrowserSession }).authBrowser.open(
        'https://api.example.test/authorize',
        RETURN_ADDRESS,
        new TestAbort().signal,
      );

      expect(browser.opened).toEqual([
        {
          url: 'https://api.example.test/authorize',
          redirectUrl: 'com.example.mobile://oauth/callback',
          options: { preferEphemeralSession: ephemeralBrowserSession },
        },
      ]);
    },
  );
});

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
} from '@app/native-adapters/testing';
import { deviceLocale, hostProps, logicalInsets } from '@app/native-ui/host';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShellAuth } from '../src/shell';

/** Written by hand: where the fake wall clock starts. */
const WALL_START = 1_800_000_000_000;

async function loadConfig(development: boolean) {
  vi.resetModules();
  vi.stubGlobal('__DEV__', development);
  return import('../src/config');
}

async function startShell() {
  const clock = new FakeTime();
  const { AUTH_CONFIGURATION, EPHEMERAL_BROWSER_SESSION } = await loadConfig(true);
  const auth = createShellAuth(
    {
      secureStore: new FakeSecureStore(),
      keychainOptions: { keychainAccessible: 4 },
      webBrowser: new FakeWebBrowser(),
      crypto: new FakeCrypto(),
      sha256Algorithm: FAKE_SHA256,
      linking: new FakeLinking(null),
      installMarker: new FakeMarkerFile(),
      recordMarker: new FakeMarkerFile(),
      uuid: new FakeUuid(),
      clock,
      timers: clock,
      http: new FakeServer(),
    },
    { configuration: AUTH_CONFIGURATION, ephemeralBrowserSession: EPHEMERAL_BROWSER_SESSION },
  );
  return { auth, clock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the bare shell hands the screens', () => {
  it.each([
    'en',
    'ar', // feature:locale-ar
  ] as const)('hands over the engine the shell built, not another one, in %s', async (locale) => {
    const { auth } = await startShell();
    const other = (await startShell()).auth;
    try {
      const props = hostProps(auth, 'Mobile CLI', locale);

      expect(props.engine).toBe(auth.engine);
      expect(props.engine).not.toBe(other.engine);
      expect(props.appName).toBe('Mobile CLI');
      expect(props.locale).toBe(locale);
    } finally {
      auth.engine.dispose();
      other.engine.dispose();
    }
  });

  it('tells the time from the clock the engine reads', async () => {
    const { auth, clock } = await startShell();
    try {
      const { now } = hostProps(auth, 'Mobile CLI', 'en');

      expect(now?.()).toBe(WALL_START);
      clock.advance(90_000);
      expect(now?.()).toBe(WALL_START + 90_000);
    } finally {
      auth.engine.dispose();
    }
  });

  it('names the app as the home screen does, in any build', async () => {
    expect((await loadConfig(true)).APP_NAME).toBe('Mobile CLI');
    expect((await loadConfig(false)).APP_NAME).toBe('Mobile CLI');
  });
});

describe('the language the bare shell starts in', () => {
  it.each([
    ['ar', 'ar'], // feature:locale-ar
    ['ar-SA', 'ar'], // feature:locale-ar
    ['ar_EG', 'ar'], // feature:locale-ar
    ['en-GB', 'en'],
    ['arc', 'en'],
    ['', 'en'],
    [undefined, 'en'],
  ] as const)('reads the device tag %j as %s', (tag, expected) => {
    expect(deviceLocale(() => tag)).toBe(expected);
  });

  it('puts the right-hand safe area on the start edge only when reading right to left', () => {
    const physical = { top: 59, bottom: 34, left: 0, right: 21 };

    expect(logicalInsets(physical, 'ar')).toEqual({ top: 59, bottom: 34, start: 21, end: 0 }); // feature:locale-ar
    expect(logicalInsets(physical, 'en')).toEqual({ top: 59, bottom: 34, start: 0, end: 21 });
  });
});

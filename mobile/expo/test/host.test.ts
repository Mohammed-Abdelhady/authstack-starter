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
import { resolveConfig, resolveDebugAccess } from '../src/logic/resolve-config';
import { createShellAuth } from '../src/shell';

/** Written by hand: where the fake wall clock starts. */
const WALL_START = 1_800_000_000_000;

function startShell() {
  const clock = new FakeTime();
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
    {
      configuration: resolveConfig({
        apiOrigin: undefined,
        development: true,
        scheme: 'com.example.mobile',
      }),
      ephemeralBrowserSession: true,
    },
  );
  return { auth, clock };
}

/** Stands in for app.json, so these cases do not depend on what the app is called. */
const APP_FILE = { expo: { name: 'Fixture Notes', scheme: 'org.fixture.notes' } };

async function loadConfig(development: boolean) {
  vi.resetModules();
  vi.doMock('../app.json', () => ({ default: APP_FILE }));
  vi.stubGlobal('__DEV__', development);
  vi.stubEnv('EXPO_PUBLIC_API_ORIGIN', 'https://api.example.test');
  return import('../src/config');
}

afterEach(() => {
  vi.doUnmock('../app.json');
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('what the Expo shell hands the screens', () => {
  it.each([
    'en',
    'ar', // feature:locale-ar
  ] as const)('hands over the engine the shell built, not another one, in %s', (locale) => {
    const { auth } = startShell();
    const other = startShell().auth;
    try {
      const props = hostProps(auth, 'Mobile Expo', locale);

      expect(props.engine).toBe(auth.engine);
      expect(props.engine).not.toBe(other.engine);
      expect(props.appName).toBe('Mobile Expo');
      expect(props.locale).toBe(locale);
    } finally {
      auth.engine.dispose();
      other.engine.dispose();
    }
  });

  it('tells the time from the clock the engine reads', () => {
    const { auth, clock } = startShell();
    try {
      const { now } = hostProps(auth, 'Mobile Expo', 'en');

      expect(now?.()).toBe(WALL_START);
      clock.advance(90_000);
      expect(now?.()).toBe(WALL_START + 90_000);
    } finally {
      auth.engine.dispose();
    }
  });

  it('names the app as app.json does', async () => {
    expect((await loadConfig(true)).APP_NAME).toBe('Fixture Notes');
  });

  it('signs in as the scheme in app.json and returns through it', async () => {
    const { AUTH_CONFIGURATION } = await loadConfig(true);

    expect(AUTH_CONFIGURATION.clientId).toBe('org.fixture.notes');
    expect(AUTH_CONFIGURATION.redirectUri).toBe('org.fixture.notes://oauth/callback');
  });
});

describe('the language the Expo shell starts in', () => {
  it.each([
    ['ar', 'ar'], // feature:locale-ar
    ['ar-SA', 'ar'], // feature:locale-ar
    ['ar_EG', 'ar'], // feature:locale-ar
    ['AR-eg', 'ar'], // feature:locale-ar
    ['en-US', 'en'],
    ['arn-CL', 'en'],
    ['fr', 'en'],
    ['', 'en'],
    [undefined, 'en'],
  ] as const)('reads the device tag %j as %s', (tag, expected) => {
    expect(deviceLocale(() => tag)).toBe(expected);
  });

  it('reads English when the device cannot name its locale', () => {
    expect(
      deviceLocale(() => {
        throw new RangeError('no locale data');
      }),
    ).toBe('en');
  });

  it('puts the right-hand safe area on the start edge only when reading right to left', () => {
    const physical = { top: 59, bottom: 34, left: 0, right: 21 };

    expect(logicalInsets(physical, 'ar')).toEqual({ top: 59, bottom: 34, start: 21, end: 0 }); // feature:locale-ar
    expect(logicalInsets(physical, 'en')).toEqual({ top: 59, bottom: 34, start: 0, end: 21 });
  });
});

describe('the sign-in check screen', () => {
  it('can open in a development build only', () => {
    expect(resolveDebugAccess(true)).toBe(true);
    expect(resolveDebugAccess(false)).toBe(false);
  });

  it('is closed in a production build', async () => {
    expect((await loadConfig(false)).DEBUG_VIEW_AVAILABLE).toBe(false);
  });

  it('is open in a development build', async () => {
    expect((await loadConfig(true)).DEBUG_VIEW_AVAILABLE).toBe(true);
  });
});

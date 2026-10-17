import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('signs in as the scheme in app.json and returns through it', async () => {
    const { AUTH_CONFIGURATION } = await loadConfig(true);

    expect(AUTH_CONFIGURATION.clientId).toBe('org.fixture.notes');
    expect(AUTH_CONFIGURATION.redirectUri).toBe('org.fixture.notes://oauth/callback');
  });
});

describe('the sign-in check screen', () => {
  it('is closed in a production build', async () => {
    expect((await loadConfig(false)).DEBUG_VIEW_AVAILABLE).toBe(false);
  });
});

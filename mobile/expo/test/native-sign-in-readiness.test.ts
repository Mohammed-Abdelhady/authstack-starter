import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthEngine } from '@app/native-auth';
import { GOOGLE_METHODS } from '../../auth/test/native/native-methods-fixtures';
import { CONFIG, ScriptedTransport, apiReply, testPorts } from '../../auth/test/support/support';
import { createShellNativeSignIn } from '../src/native-sign-in';

const boundary = vi.hoisted(() => ({
  platform: { OS: 'android' },
  checkPlayServices: vi.fn<(showDialog: boolean) => Promise<void>>(),
}));
vi.mock('react-native', () => ({ Platform: boundary.platform }));
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      ios: { bundleIdentifier: 'com.example.mobile' },
      extra: { nativeSignIn: { googleIosUrlScheme: 'com.googleusercontent.apps.ios-client' } },
    },
  },
}));
vi.mock('react-native-fbsdk-next', () => ({
  AccessToken: {},
  AuthenticationToken: {},
  LoginManager: {},
  Settings: {},
}));
vi.mock('react-native-nitro-google-signin', () => ({
  GoogleOneTapSignIn: { checkPlayServices: boundary.checkPlayServices },
}));
const METHODS = {
  ...GOOGLE_METHODS,
  providers: [
    {
      id: 'google',
      displayName: 'Google',
      mode: 'googleIdentityToken' as const,
      sdk: {
        kind: 'google' as const,
        webClientId: 'web-client.apps.googleusercontent.com',
        iosClientId: 'ios-client.apps.googleusercontent.com',
      },
    },
  ],
};

beforeEach(() => {
  boundary.platform.OS = 'android';
  boundary.checkPlayServices.mockReset().mockResolvedValue();
});

describe('Google native readiness', () => {
  it('checks Android services without showing a resolution dialog', async () => {
    const ports = createShellNativeSignIn();
    expect(await ports.providerSignIn.available(METHODS.providers[0])).toBe(true);
    expect(boundary.checkPlayServices.mock.calls).toEqual([[false]]);
  });

  it('preserves the system provider when Android services are unavailable', async () => {
    boundary.checkPlayServices.mockRejectedValue(new Error('PLAY_SERVICES_NOT_AVAILABLE'));
    const transport = new ScriptedTransport();
    transport.respond = async () => apiReply(METHODS);
    const engine = createAuthEngine(CONFIG, {
      ...testPorts(transport),
      ...createShellNativeSignIn(),
    });
    try {
      const methods = await engine.methods();
      expect(methods.providers).toEqual([{ id: 'google', displayName: 'Google', mode: 'system' }]);
      expect(boundary.checkPlayServices.mock.calls).toEqual([[false]]);
    } finally {
      engine.dispose();
    }
  });

  it('keeps iOS independent from Android Play Services', async () => {
    boundary.platform.OS = 'ios';
    const ports = createShellNativeSignIn();
    expect(await ports.providerSignIn.available(METHODS.providers[0])).toBe(true);
    expect(boundary.checkPlayServices.mock.calls).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { configureNativeSignIn, readNativeBuildSettings } from '../build-config/native-sign-in.cjs';

describe('native SDK build configuration', () => {
  const original = {
    name: 'Example Mobile',
    scheme: 'example',
    plugins: ['expo-secure-store'],
    ios: { bundleIdentifier: 'example.mobile', associatedDomains: ['applinks:existing.example'] },
    android: { package: 'example.mobile' },
  };

  it('preserves an unconfigured shell', () => {
    expect(configureNativeSignIn(original, {})).toEqual(original);
  });

  // feature:apple:start
  it('publishes the declared public Apple setting for the runtime adapter', () => {
    const configured = configureNativeSignIn(
      original,
      Object.assign({ appleSignIn: true }, { appSecret: 'must-not-export' }),
    );
    expect(configured.extra).toEqual({ nativeSignIn: { appleSignIn: true } });
  });
  // feature:apple:end

  // feature:facebook:start
  it('publishes the declared public Facebook settings for the runtime adapter', () => {
    const configured = configureNativeSignIn(
      original,
      Object.assign(
        { facebookAppId: '123456', facebookClientToken: 'public-client-token' },
        { appSecret: 'must-not-export' },
      ),
    );
    expect(configured.extra).toEqual({
      nativeSignIn: { facebookAppId: '123456', facebookClientToken: 'public-client-token' },
    });
  });
  // feature:facebook:end

  // feature:google:start
  it('configures public Google SDK settings', () => {
    const configured = configureNativeSignIn(original, {
      googleIosUrlScheme: 'com.googleusercontent.apps.123-example',
    });
    expect(configured.plugins).toEqual([
      'expo-secure-store',
      [
        'react-native-nitro-google-signin',
        { iosUrlScheme: 'com.googleusercontent.apps.123-example' },
      ],
    ]);
  });
  // feature:google:end

  // feature:apple:start
  it('configures public Apple SDK settings', () => {
    const configured = configureNativeSignIn(original, {
      appleSignIn: true,
    });
    expect(configured.plugins).toEqual(['expo-secure-store', 'expo-apple-authentication']);
    expect(configured.ios?.usesAppleSignIn).toBe(true);
    expect(original.ios).not.toHaveProperty('usesAppleSignIn');
  });
  // feature:apple:end

  // feature:facebook:start
  it('configures Facebook without automatic SDK initialization or collection', () => {
    const configured = configureNativeSignIn(original, {
      facebookAppId: '123456',
      facebookClientToken: 'public-client-token',
    });
    expect(configured.plugins).toEqual([
      'expo-secure-store',
      [
        'react-native-fbsdk-next',
        {
          appID: '123456',
          clientToken: 'public-client-token',
          displayName: 'Example Mobile',
          scheme: 'fb123456',
          isAutoInitEnabled: false,
          autoLogAppEventsEnabled: false,
          advertiserIDCollectionEnabled: false,
          iosUserTrackingPermission: false,
        },
      ],
    ]);
  });
  // feature:facebook:end

  it.each([
    { googleIosUrlScheme: 'https://evil.example' },
    { facebookAppId: '123456' },
    { facebookClientToken: 'public-client-token' },
    { facebookAppId: 'invalid', facebookClientToken: 'public-client-token' },
    { facebookAppId: '123456', facebookClientToken: ' ' },
    { appLinkPath: '//outside.example' },
  ])('refuses incomplete or malformed public settings %j', (settings) => {
    expect(() => configureNativeSignIn(original, settings)).toThrow();
  });

  // feature:passkeys:start
  it('adds exact associated domains and callback intent without replacing existing settings', () => {
    const configured = configureNativeSignIn(original, {
      passkeyRpId: 'accounts.example.com',
      appLinkHost: 'existing.example',
      appLinkPath: '/auth/callback',
    });
    expect(configured.ios).toEqual({
      bundleIdentifier: 'example.mobile',
      associatedDomains: ['applinks:existing.example', 'webcredentials:accounts.example.com'],
    });
    expect(configured.android).toEqual({
      package: 'example.mobile',
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: 'existing.example', pathPrefix: '/auth/callback' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    });
  });
  // feature:passkeys:end

  it.each([
    'https://example.com',
    'example.com/path',
    '*.example.com',
    ' user.example.com',
    'user@example.com',
    'example.com:443',
    '127.0.0.1',
    'localhost',
    `${'a'.repeat(64)}.example`,
  ])('refuses domain %s', (domain) => {
    expect(() => configureNativeSignIn(original, { passkeyRpId: domain })).toThrow();
    expect(() => configureNativeSignIn(original, { appLinkHost: domain })).toThrow();
  });

  it('reads only named public identifiers and parses the Apple switch strictly', () => {
    expect(
      readNativeBuildSettings({ MOBILE_APPLE_SIGN_IN_ENABLED: 'false', UNRELATED: 'ignored' }),
    ).toEqual({ appleSignIn: false });
    expect(readNativeBuildSettings({ MOBILE_APPLE_SIGN_IN_ENABLED: 'true' })).toEqual({
      appleSignIn: true,
    });
    expect(() => readNativeBuildSettings({ MOBILE_APPLE_SIGN_IN_ENABLED: 'yes' })).toThrow();
  });
});

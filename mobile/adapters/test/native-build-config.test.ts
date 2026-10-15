import { describe, expect, it } from 'vitest';
import { configureNativeSignIn, readNativeBuildSettings } from '../build-config/native-sign-in.cjs';
// feature:google,facebook:start
import type { NativeBuildConfiguration } from '../src/types/native-build-config';
// feature:google,facebook:end
// feature:google:start
import type { NativeBuildPlugin } from '../src/types/native-build-config';
// feature:google:end

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

  it('keeps host strings and tuples in order before appending sign-in plugins', () => {
    const host: NativeBuildConfiguration = {
      plugins: ['host-plugin', ['host-options', { nested: { enabled: true }, count: 2 }]],
    };
    const configured = configureNativeSignIn(host, {
      googleIosUrlScheme: 'com.googleusercontent.apps.123-example',
    });

    expect(configured.plugins).toEqual([
      'host-plugin',
      ['host-options', { nested: { enabled: true }, count: 2 }],
      [
        'react-native-nitro-google-signin',
        { iosUrlScheme: 'com.googleusercontent.apps.123-example' },
      ],
    ]);
    expect(host).toEqual({
      plugins: ['host-plugin', ['host-options', { nested: { enabled: true }, count: 2 }]],
    });
    expect(configured.plugins?.[1]).toBe(host.plugins?.[1]);
  });

  it('keeps an identical host tuple once', () => {
    const host: NativeBuildConfiguration = {
      plugins: [
        'host-plugin',
        [
          'react-native-nitro-google-signin',
          { iosUrlScheme: 'com.googleusercontent.apps.123-example' },
        ],
      ],
    };
    const configured = configureNativeSignIn(host, {
      googleIosUrlScheme: 'com.googleusercontent.apps.123-example',
    });

    expect(configured.plugins).toEqual([
      'host-plugin',
      [
        'react-native-nitro-google-signin',
        { iosUrlScheme: 'com.googleusercontent.apps.123-example' },
      ],
    ]);
    expect(configured.plugins?.[1]).toBe(host.plugins?.[1]);
  });

  it.each([3, 4])('refuses a host tuple with trailing holes and length %i', (length) => {
    const iosUrlScheme = 'com.googleusercontent.apps.123-example';
    const plugin: NativeBuildPlugin = ['react-native-nitro-google-signin', { iosUrlScheme }];
    Object.defineProperty(plugin, 'length', { value: length });
    expect(() =>
      configureNativeSignIn({ plugins: [plugin] }, { googleIosUrlScheme: iosUrlScheme }),
    ).toThrow(new TypeError(`Plugin ${plugin[0]}: the host already configures it differently`));
  });

  it('refuses a conflicting host tuple or bare string', () => {
    const plugins: NativeBuildPlugin[] = [
      'react-native-nitro-google-signin',
      ['react-native-nitro-google-signin', { iosUrlScheme: 'host-scheme' }],
    ];
    for (const plugin of plugins) {
      const host = { plugins: ['host-plugin', plugin] };
      const configure = () =>
        configureNativeSignIn(host, {
          googleIosUrlScheme: 'com.googleusercontent.apps.123-example',
        });
      expect(configure).toThrow(TypeError);
      expect(configure).toThrow(
        'Plugin react-native-nitro-google-signin: the host already configures it differently',
      );
    }
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

  it('keeps an identical host string once', () => {
    const configured = configureNativeSignIn(
      { plugins: ['host-plugin', 'expo-apple-authentication'] },
      { appleSignIn: true },
    );

    expect(configured.plugins).toEqual(['host-plugin', 'expo-apple-authentication']);
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

  it('keeps deeply equal host options regardless of key order', () => {
    const options = {
      iosUserTrackingPermission: false,
      advertiserIDCollectionEnabled: false,
      autoLogAppEventsEnabled: false,
      isAutoInitEnabled: false,
      scheme: 'fb123456',
      displayName: 'Example Mobile',
      clientToken: 'public-client-token',
      appID: '123456',
    };
    const host: NativeBuildConfiguration = {
      ...original,
      plugins: [['react-native-fbsdk-next', options]],
    };
    const configured = configureNativeSignIn(host, {
      facebookAppId: '123456',
      facebookClientToken: 'public-client-token',
    });

    expect(configured.plugins).toEqual([
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

  it.each([
    { values: { MOBILE_APP_LINK_PATHS: ' /first, /second ' }, paths: ['/first', '/second'] },
    { values: { MOBILE_APP_LINK_PATH: '/legacy' }, paths: ['/legacy'] },
    {
      values: { MOBILE_APP_LINK_PATHS: '/first,/second', MOBILE_APP_LINK_PATH: '//ignored' },
      paths: ['/first', '/second'],
    },
    { values: { MOBILE_APP_LINK_PATHS: ' , , ' }, paths: ['/oauth/callback'] },
    {
      values: { MOBILE_APP_LINK_PATHS: ' , ', MOBILE_APP_LINK_PATH: '/ignored' },
      paths: ['/oauth/callback'],
    },
    {
      values: { MOBILE_APP_LINK_PATHS: '/first, /first, /second,/first' },
      paths: ['/first', '/second'],
    },
  ])('configures app-link paths from $values', ({ values, paths }) => {
    const settings = readNativeBuildSettings({ MOBILE_APP_LINK_HOST: 'links.example', ...values });
    const configured = configureNativeSignIn({}, settings);

    expect(configured.android?.intentFilters).toEqual(
      paths.map((pathPrefix) => ({
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'links.example', pathPrefix }],
        category: ['BROWSABLE', 'DEFAULT'],
      })),
    );
    expect(configured.ios?.associatedDomains).toEqual(['applinks:links.example']);
  });

  it('omits an empty list from the public settings', () => {
    expect(readNativeBuildSettings({ MOBILE_APP_LINK_PATHS: ' , , ' })).toEqual({});
  });

  it.each([
    'relative',
    '//outside.example',
    '/callback?query',
    '/callback#hash',
    '/two paths',
    '/call\u0001back',
    '/call\u007fback',
    '/callback\n',
    '/callback\t',
  ])('refuses invalid list entries like a single path: %s', (path) => {
    expect(() =>
      configureNativeSignIn(
        {},
        readNativeBuildSettings({
          MOBILE_APP_LINK_HOST: 'links.example',
          MOBILE_APP_LINK_PATHS: `/valid,${path}`,
        }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      configureNativeSignIn({}, { appLinkHost: 'links.example', appLinkPath: path }),
    ).toThrow(TypeError);
  });

  it('requires a host for a nonempty list and preserves direct single-path inputs', () => {
    expect(() => configureNativeSignIn({}, { appLinkPaths: ['/callback'] })).toThrow(TypeError);
    const configured = configureNativeSignIn(
      {},
      { appLinkHost: 'links.example', appLinkPath: '/direct' },
    );
    expect(configured.android?.intentFilters?.[0]?.data[0]?.pathPrefix).toBe('/direct');
  });
});

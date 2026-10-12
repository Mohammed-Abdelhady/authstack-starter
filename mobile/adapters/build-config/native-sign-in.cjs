const GOOGLE_SCHEME_PATTERN = /^com\.googleusercontent\.apps\.[A-Za-z0-9-]+$/u;
const DOMAIN_PATTERN = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/u;
const DEFAULT_CALLBACK_PATH = '/oauth/callback';

/** @typedef {import('../src/types/native-build-config').NativeBuildSettings} Settings */
/** @typedef {import('../src/types/native-build-config').NativeBuildConfiguration} Configuration */

/** @param {string} value */
function associatedDomain(value) {
  if (value.length > 253 || !DOMAIN_PATTERN.test(value)) {
    throw new TypeError('An associated domain must be an exact DNS hostname');
  }
  return value.toLowerCase();
}

/** @param {Settings} settings */
function validateSettings(settings) {
  if (settings.googleIosUrlScheme && !GOOGLE_SCHEME_PATTERN.test(settings.googleIosUrlScheme)) {
    throw new TypeError('Google requires its reversed iOS client URL scheme');
  }
  if (settings.facebookAppId || settings.facebookClientToken || settings.facebookDisplayName) {
    if (
      !settings.facebookAppId ||
      !/^\d+$/u.test(settings.facebookAppId) ||
      !settings.facebookClientToken ||
      /\s/u.test(settings.facebookClientToken)
    ) {
      throw new TypeError('Facebook requires an app ID and its public client token');
    }
  }
  if (
    settings.appLinkPath &&
    (!/^\/(?!\/)[^?#\s]*$/u.test(settings.appLinkPath) || !settings.appLinkHost)
  ) {
    throw new TypeError('An app-link callback requires an exact host and absolute path');
  }
}

/** @param {Settings} settings @returns {Settings} */
function publicSettings(settings) {
  return {
    ...(settings.googleIosUrlScheme ? { googleIosUrlScheme: settings.googleIosUrlScheme } : {}),
    ...(settings.appleSignIn === undefined ? {} : { appleSignIn: settings.appleSignIn }),
    ...(settings.facebookAppId ? { facebookAppId: settings.facebookAppId } : {}),
    ...(settings.facebookClientToken ? { facebookClientToken: settings.facebookClientToken } : {}),
    ...(settings.facebookDisplayName ? { facebookDisplayName: settings.facebookDisplayName } : {}),
    ...(settings.passkeyRpId ? { passkeyRpId: associatedDomain(settings.passkeyRpId) } : {}),
    ...(settings.appLinkHost ? { appLinkHost: associatedDomain(settings.appLinkHost) } : {}),
    ...(settings.appLinkPath ? { appLinkPath: settings.appLinkPath } : {}),
  };
}

/**
 * @template {Configuration} T
 * @param {T} config
 * @param {Settings} settings
 */
function configureNativeSignIn(config, settings) {
  validateSettings(settings);
  const plugins = [...(config.plugins ?? [])];
  // feature:google:start
  if (settings.googleIosUrlScheme) {
    plugins.push([
      'react-native-nitro-google-signin',
      { iosUrlScheme: settings.googleIosUrlScheme },
    ]);
  }
  // feature:google:end
  // feature:apple:start
  if (settings.appleSignIn) plugins.push('expo-apple-authentication');
  // feature:apple:end
  // feature:facebook:start
  if (settings.facebookAppId && settings.facebookClientToken) {
    const displayName = settings.facebookDisplayName ?? config.name;
    if (!displayName) throw new TypeError('Facebook requires the application display name');
    plugins.push([
      'react-native-fbsdk-next',
      {
        appID: settings.facebookAppId,
        clientToken: settings.facebookClientToken,
        displayName,
        scheme: `fb${settings.facebookAppId}`,
        isAutoInitEnabled: false,
        autoLogAppEventsEnabled: false,
        advertiserIDCollectionEnabled: false,
        iosUserTrackingPermission: false,
      },
    ]);
  }
  // feature:facebook:end
  const domains = [...(config.ios?.associatedDomains ?? [])];
  // feature:passkeys:start
  if (settings.passkeyRpId)
    domains.push(`webcredentials:${associatedDomain(settings.passkeyRpId)}`);
  // feature:passkeys:end
  const appLinkHost = settings.appLinkHost ? associatedDomain(settings.appLinkHost) : undefined;
  if (appLinkHost) domains.push(`applinks:${appLinkHost}`);
  const intentFilters = [...(config.android?.intentFilters ?? [])];
  if (appLinkHost) {
    intentFilters.push({
      action: 'VIEW',
      autoVerify: true,
      data: [
        {
          scheme: 'https',
          host: appLinkHost,
          pathPrefix: settings.appLinkPath ?? DEFAULT_CALLBACK_PATH,
        },
      ],
      category: ['BROWSABLE', 'DEFAULT'],
    });
  }
  return {
    ...config,
    ...(Object.keys(settings).length
      ? {
          extra: { ...config.extra, nativeSignIn: publicSettings(settings) },
        }
      : {}),
    ...(plugins.length ? { plugins } : {}),
    ...(settings.appleSignIn || domains.length
      ? {
          ios: {
            ...config.ios,
            ...(settings.appleSignIn ? { usesAppleSignIn: true } : {}),
            ...(domains.length ? { associatedDomains: [...new Set(domains)] } : {}),
          },
        }
      : {}),
    ...(intentFilters.length ? { android: { ...config.android, intentFilters } } : {}),
  };
}

/** @param {Record<string, string | undefined>} values @returns {Settings} */
function readNativeBuildSettings(values) {
  const apple = values.MOBILE_APPLE_SIGN_IN_ENABLED;
  if (apple && apple !== 'true' && apple !== 'false') {
    throw new TypeError('MOBILE_APPLE_SIGN_IN_ENABLED must be true or false');
  }
  return {
    ...(values.MOBILE_GOOGLE_IOS_URL_SCHEME
      ? { googleIosUrlScheme: values.MOBILE_GOOGLE_IOS_URL_SCHEME }
      : {}),
    ...(apple ? { appleSignIn: apple === 'true' } : {}),
    ...(values.MOBILE_FACEBOOK_APP_ID ? { facebookAppId: values.MOBILE_FACEBOOK_APP_ID } : {}),
    ...(values.MOBILE_FACEBOOK_CLIENT_TOKEN
      ? { facebookClientToken: values.MOBILE_FACEBOOK_CLIENT_TOKEN }
      : {}),
    ...(values.MOBILE_FACEBOOK_DISPLAY_NAME
      ? { facebookDisplayName: values.MOBILE_FACEBOOK_DISPLAY_NAME }
      : {}),
    ...(values.MOBILE_PASSKEY_RP_ID ? { passkeyRpId: values.MOBILE_PASSKEY_RP_ID } : {}),
    ...(values.MOBILE_APP_LINK_HOST ? { appLinkHost: values.MOBILE_APP_LINK_HOST } : {}),
    ...(values.MOBILE_APP_LINK_PATH ? { appLinkPath: values.MOBILE_APP_LINK_PATH } : {}),
  };
}

module.exports = { configureNativeSignIn, readNativeBuildSettings };

const GOOGLE_SCHEME_PATTERN = /^com\.googleusercontent\.apps\.[A-Za-z0-9-]+$/u;
const DOMAIN_PATTERN = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/u;
const DEFAULT_CALLBACK_PATH = '/oauth/callback';
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;
const APP_LINK_PATH_ERROR = 'An app-link callback requires an exact host and absolute path';

/** @typedef {import('../src/types/native-build-config').NativeBuildSettings} Settings */
/** @typedef {import('../src/types/native-build-config').NativeBuildConfiguration} Configuration */
/** @typedef {import('../src/types/native-build-config').NativeBuildPlugin} Plugin */
/** @typedef {import('../src/types/native-build-config').NativeBuildIntentFilter} IntentFilter */

/** @param {string} value */
function associatedDomain(value) {
  if (value.length > 253 || !DOMAIN_PATTERN.test(value)) {
    throw new TypeError('An associated domain must be an exact DNS hostname');
  }
  return value.toLowerCase();
}

/** @param {Settings} settings */
function validateFacebook(settings) {
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
}

/** @param {string[]} paths */
function normalizePaths(paths) {
  if (paths.some((path) => CONTROL_CHARACTER_PATTERN.test(path))) {
    throw new TypeError(APP_LINK_PATH_ERROR);
  }
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
}

/** @param {Settings} settings */
function explicitPaths(settings) {
  if (settings.appLinkPaths !== undefined) return normalizePaths(settings.appLinkPaths);
  return settings.appLinkPath ? [settings.appLinkPath] : [];
}

/** @param {Settings} settings */
function validateSettings(settings) {
  if (settings.googleIosUrlScheme && !GOOGLE_SCHEME_PATTERN.test(settings.googleIosUrlScheme)) {
    throw new TypeError('Google requires its reversed iOS client URL scheme');
  }
  validateFacebook(settings);
  for (const path of explicitPaths(settings)) {
    if (
      !/^\/(?!\/)[^?#\s]*$/u.test(path) ||
      CONTROL_CHARACTER_PATTERN.test(path) ||
      !settings.appLinkHost
    ) {
      throw new TypeError(APP_LINK_PATH_ERROR);
    }
  }
}

/** @param {Settings} settings */
function publicPaths(settings) {
  if (settings.appLinkPaths !== undefined) {
    const appLinkPaths = explicitPaths(settings);
    return appLinkPaths.length ? { appLinkPaths } : {};
  }
  return settings.appLinkPath ? { appLinkPath: settings.appLinkPath } : {};
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
    ...publicPaths(settings),
  };
}

/** Plugin options are plain JSON, so key order is ignored. @param {unknown} left @param {unknown} right @returns {boolean} */
function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftEntries = Object.entries(left);
  const rightValues = new Map(Object.entries(right));
  return (
    leftEntries.length === rightValues.size &&
    leftEntries.every(
      ([key, value]) => rightValues.has(key) && sameValue(value, rightValues.get(key)),
    )
  );
}

/** @param {Plugin} plugin */
function pluginName(plugin) {
  return typeof plugin === 'string' ? plugin : plugin[0];
}

/** @param {Plugin[]} plugins @param {Plugin} plugin */
function appendPlugin(plugins, plugin) {
  const name = pluginName(plugin);
  const matches = plugins.filter((entry) => pluginName(entry) === name);
  for (const entry of matches) {
    if (!sameValue(entry, plugin)) {
      throw new TypeError(`Plugin ${name}: the host already configures it differently`);
    }
  }
  return matches.length ? plugins : [...plugins, plugin];
}

// feature:facebook:start
/** @param {Configuration} config @param {Settings} settings @returns {Plugin} */
function facebookPlugin(config, settings) {
  const displayName = settings.facebookDisplayName ?? config.name;
  if (!displayName) throw new TypeError('Facebook requires the application display name');
  return [
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
  ];
}
// feature:facebook:end

/** @param {Configuration} config @param {Settings} _settings */
function signInPlugins(config, _settings) {
  const plugins = [...(config.plugins ?? [])];
  /** @type {Plugin[]} */
  const additions = [];
  // feature:google:start
  if (_settings.googleIosUrlScheme) {
    additions.push([
      'react-native-nitro-google-signin',
      { iosUrlScheme: _settings.googleIosUrlScheme },
    ]);
  }
  // feature:google:end
  // feature:apple:start
  if (_settings.appleSignIn) additions.push('expo-apple-authentication');
  // feature:apple:end
  // feature:facebook:start
  if (_settings.facebookAppId && _settings.facebookClientToken) {
    additions.push(facebookPlugin(config, _settings));
  }
  // feature:facebook:end
  return additions.reduce(appendPlugin, plugins);
}

/** @param {Configuration} config @param {Settings} settings */
function associatedDomains(config, settings) {
  const domains = [...(config.ios?.associatedDomains ?? [])];
  // feature:passkeys:start
  if (settings.passkeyRpId)
    domains.push(`webcredentials:${associatedDomain(settings.passkeyRpId)}`);
  // feature:passkeys:end
  const appLinkHost = settings.appLinkHost ? associatedDomain(settings.appLinkHost) : undefined;
  if (appLinkHost) domains.push(`applinks:${appLinkHost}`);
  return domains;
}

/** @param {Configuration} config @param {Settings} settings */
function appLinkIntentFilters(config, settings) {
  const appLinkHost = settings.appLinkHost ? associatedDomain(settings.appLinkHost) : undefined;
  const intentFilters = [...(config.android?.intentFilters ?? [])];
  if (!appLinkHost) return intentFilters;
  const paths = explicitPaths(settings);
  if (paths.length === 0) {
    paths.push(
      settings.appLinkPaths === undefined
        ? (settings.appLinkPath ?? DEFAULT_CALLBACK_PATH)
        : DEFAULT_CALLBACK_PATH,
    );
  }
  for (const pathPrefix of paths) {
    /** @type {IntentFilter} */
    const filter = {
      action: 'VIEW',
      autoVerify: true,
      data: [
        {
          scheme: 'https',
          host: appLinkHost,
          pathPrefix,
        },
      ],
      category: ['BROWSABLE', 'DEFAULT'],
    };
    intentFilters.push(filter);
  }
  return intentFilters;
}

/** @template {Configuration} T @param {T} config @param {Settings} settings */
function configureNativeSignIn(config, settings) {
  validateSettings(settings);
  const plugins = signInPlugins(config, settings);
  const domains = associatedDomains(config, settings);
  const intentFilters = appLinkIntentFilters(config, settings);
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

/** @param {string | undefined} apple */
function appleSetting(apple) {
  if (apple && apple !== 'true' && apple !== 'false') {
    throw new TypeError('MOBILE_APPLE_SIGN_IN_ENABLED must be true or false');
  }
  return apple ? { appleSignIn: apple === 'true' } : {};
}

/** @param {Record<string, string | undefined>} values */
function appLinkPathSettings(values) {
  const list = values['MOBILE_APP_LINK_PATHS'];
  if (list !== undefined) {
    const appLinkPaths = normalizePaths(list.split(','));
    return appLinkPaths.length ? { appLinkPaths } : {};
  }
  return values['MOBILE_APP_LINK_PATH'] ? { appLinkPath: values['MOBILE_APP_LINK_PATH'] } : {};
}

/** @param {Record<string, string | undefined>} values @returns {Settings} */
function readNativeBuildSettings(values) {
  return {
    ...(values['MOBILE_GOOGLE_IOS_URL_SCHEME']
      ? { googleIosUrlScheme: values['MOBILE_GOOGLE_IOS_URL_SCHEME'] }
      : {}),
    ...appleSetting(values['MOBILE_APPLE_SIGN_IN_ENABLED']),
    ...(values['MOBILE_FACEBOOK_APP_ID']
      ? { facebookAppId: values['MOBILE_FACEBOOK_APP_ID'] }
      : {}),
    ...(values['MOBILE_FACEBOOK_CLIENT_TOKEN']
      ? { facebookClientToken: values['MOBILE_FACEBOOK_CLIENT_TOKEN'] }
      : {}),
    ...(values['MOBILE_FACEBOOK_DISPLAY_NAME']
      ? { facebookDisplayName: values['MOBILE_FACEBOOK_DISPLAY_NAME'] }
      : {}),
    ...(values['MOBILE_PASSKEY_RP_ID'] ? { passkeyRpId: values['MOBILE_PASSKEY_RP_ID'] } : {}),
    ...(values['MOBILE_APP_LINK_HOST'] ? { appLinkHost: values['MOBILE_APP_LINK_HOST'] } : {}),
    ...appLinkPathSettings(values),
  };
}

module.exports = { configureNativeSignIn, readNativeBuildSettings };

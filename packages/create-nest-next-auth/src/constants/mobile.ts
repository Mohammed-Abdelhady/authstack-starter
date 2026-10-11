import type { MobileIdentityField } from '../types/mobile.js';

export const MOBILE_IDENTITY_FIELDS: readonly MobileIdentityField[] = [
  'name',
  'slug',
  'appId',
  'scheme',
];

/** The flag that sets each field, named in every message about it. */
export const MOBILE_FLAGS: Record<MobileIdentityField, string> = {
  name: '--mobile-name',
  slug: '--mobile-slug',
  appId: '--mobile-app-id',
  scheme: '--mobile-scheme',
};

export const MOBILE_PROMPTS: Record<MobileIdentityField, string> = {
  name: 'Mobile app name, shown under the icon',
  slug: 'Mobile project slug, used by Expo',
  appId: 'Application id for iOS and Android',
  scheme: 'Scheme that sign-in returns through',
};

/** The longest name both stores accept as an app title. */
export const MOBILE_NAME_MAX_LENGTH = 30;

export const MOBILE_SLUG_MAX_LENGTH = 64;

/** The iOS limit, the shorter of the two platforms. */
export const MOBILE_APP_ID_MAX_LENGTH = 155;

/** The scheme is also the client id, which the server caps at this length. */
export const MOBILE_SCHEME_MAX_LENGTH = 128;

export const MOBILE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** One dot separated part of an application id: Android wants a leading letter, iOS no underscore. */
export const MOBILE_APP_ID_SEGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/** RFC 3986 without `+`, which the server refuses in a client id. */
export const MOBILE_SCHEME_PATTERN = /^[a-z][a-z0-9.-]*$/;

/** Code points a name may not hold: control characters and the two Unicode line separators. */
export const MOBILE_NAME_LOWEST_PRINTABLE = 0x20;
export const MOBILE_NAME_FORBIDDEN_CODES: ReadonlySet<number> = new Set([0x7f, 0x2028, 0x2029]);

/** Schemes a browser or an operating system already owns. */
export const RESERVED_SCHEMES: ReadonlySet<string> = new Set([
  'http',
  'https',
  'file',
  'ftp',
  'ws',
  'wss',
  'data',
  'blob',
  'about',
  'javascript',
  'vbscript',
  'mailto',
  'tel',
  'sms',
  'geo',
  'content',
  'intent',
  'market',
  'itms',
  'itms-apps',
  'exp',
  'exps',
]);

/** Client ids the server keeps for its own web and admin apps. The scheme is the app's client id. */
export const SERVER_CLIENT_IDS: ReadonlySet<string> = new Set(['web', 'admin']);

/** Android refuses a package part that is a Java keyword. */
export const JAVA_KEYWORDS: ReadonlySet<string> = new Set(
  (
    'abstract assert boolean break byte case catch char class const continue default do double ' +
    'else enum extends false final finally float for goto if implements import instanceof int ' +
    'interface long native new null package private protected public return short static ' +
    'strictfp super switch synchronized this throw throws transient true try void volatile while'
  ).split(' '),
);

/** Where a default application id and scheme start. A placeholder to replace before release. */
export const MOBILE_DEFAULT_ID_PREFIX = 'com.example';

/** Stands in when the project name has no letter or digit to build from. */
export const MOBILE_FALLBACK_WORD = 'app';

/** What follows the scheme in the address sign-in returns to. The app builds the same one. */
export const MOBILE_CALLBACK_LOCATION = 'oauth/callback';

/** Each mobile target's app config, the one place its identity is kept. */
export const MOBILE_APP_CONFIG_FILES: Record<string, string> = {
  'native-expo': 'mobile/expo/app.json',
};

export const NATIVE_APPLICATIONS_VAR = 'AUTH_NATIVE_APPLICATIONS';

/** Every shipped file that carries an example registration for the mobile app. */
export const NATIVE_REGISTRATION_FILES = [
  'backend/.env.example',
  '.env.docker.example',
  'backend/README.md',
] as const;

/** The project name used for defaults before the directory is known. */
export const MOBILE_DEFAULT_PROJECT_NAME = 'my-app';

/** Builds the native iOS project and starts the app on a simulator. */
export const MOBILE_RUN_COMMAND = 'pnpm --filter @app/mobile-expo run ios';

/** The variable a development build reads the API address from. */
export const MOBILE_API_ORIGIN_VAR = 'EXPO_PUBLIC_API_ORIGIN';

/** Where docker-compose.yml publishes the API. The app looks on another port unless told. */
export const DOCKER_API_ORIGIN = 'http://localhost:5000';

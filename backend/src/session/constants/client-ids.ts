export const WEB_CLIENT_ID = 'web';
export const ADMIN_CLIENT_ID = 'admin';
export const NATIVE_APPLICATIONS_CONFIG_VARIABLE = 'AUTH_NATIVE_APPLICATIONS';
export const NATIVE_CLIENT_ID_MAX_LENGTH = 128;
export const NATIVE_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~-]+$/;
export const NATIVE_SCOPE_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
export const NATIVE_APPLICATION_KNOWN_KEYS = [
  'clientId',
  'displayName',
  'redirectUris',
  'allowedScopes',
  'signIn',
  'signUp',
  'audience',
  'requirePasskey',
  'session',
  'firstParty',
  'appleAppId',
  'androidPackage',
  'androidCertificates',
] as const;

export const APPLICATION_PLATFORM = {
  WEB: 'web',
  ADMIN: 'admin',
  NATIVE: 'native',
} as const;

export type ApplicationPlatform =
  (typeof APPLICATION_PLATFORM)[keyof typeof APPLICATION_PLATFORM];

export const APPLICATION_CLIENT_TYPE = {
  PUBLIC: 'public',
  CONFIDENTIAL: 'confidential',
} as const;

export const DEFAULT_API_AUDIENCE = 'api';

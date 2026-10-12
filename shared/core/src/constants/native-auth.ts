import { MAX_PASSWORD_BYTES } from '../password-rules';

export const NATIVE_AUTH_HEADER = 'X-Native-Attempt';

export const NATIVE_EMAIL_CALLBACK_PARAM = {
  ATTEMPT_ID: 'native_attempt_id',
  EMAIL_TOKEN: 'native_email_token',
  STATE: 'state',
} as const;

export const NATIVE_AUTH_FLOW = {
  SIGN_IN: 'signIn',
  REGISTRATION: 'registration',
  RECOVERY: 'recovery',
} as const;

export const NATIVE_AUTH_STAGE = {
  FIRST_FACTOR_REQUIRED: 'firstFactorRequired',
  EMAIL_LINK_SENT: 'emailLinkSent',
  REGISTRATION_CODE_REQUIRED: 'registrationCodeRequired',
  RECOVERY_CODE_REQUIRED: 'recoveryCodeRequired',
  SECOND_FACTOR_REQUIRED: 'secondFactorRequired',
  CONSENT_REQUIRED: 'consentRequired',
  CODE_READY: 'codeReady',
  DENIED: 'denied',
  RECOVERY_COMPLETE: 'recoveryComplete',
} as const;

export const NATIVE_PROVIDER_CREDENTIAL_KIND = {
  GOOGLE_IDENTITY_TOKEN: 'googleIdentityToken',
  APPLE_IDENTITY_TOKEN_AND_CODE: 'appleIdentityTokenAndCode',
  FACEBOOK_LIMITED_TOKEN: 'facebookLimitedToken',
  FACEBOOK_ACCESS_TOKEN: 'facebookAccessToken',
} as const;

export const NATIVE_PROVIDER_SDK_MODE = {
  SYSTEM: 'system',
  GOOGLE_IDENTITY_TOKEN: NATIVE_PROVIDER_CREDENTIAL_KIND.GOOGLE_IDENTITY_TOKEN,
  APPLE_IDENTITY_TOKEN_AND_CODE: NATIVE_PROVIDER_CREDENTIAL_KIND.APPLE_IDENTITY_TOKEN_AND_CODE,
  FACEBOOK: 'facebook',
} as const;

export const NATIVE_AUTH_FIRST_FACTOR = {
  PASSWORD: 'password',
  PROVIDER: 'provider',
  PASSKEY: 'passkey',
  EMAIL_LINK: 'emailLink',
} as const;

export const NATIVE_AUTH_SECOND_FACTOR = {
  TOTP: 'totp',
  RECOVERY_CODE: 'recoveryCode',
  PASSKEY: 'passkey',
} as const;

export const NATIVE_AUTH_LIMITS = {
  CLIENT_ID: 128,
  ATTEMPT_ID: 128,
  ATTEMPT_SECRET_LENGTH: 43,
  PROVIDER_NONCE_DIGEST_LENGTH: 64,
  PROVIDER_ID: 64,
  PROVIDER_NAME: 160,
  PROVIDER_COUNT: 32,
  EMAIL: 255,
  NAME: 100,
  STATE: 512,
  REDIRECT_URI: 2048,
  CALLBACK_URI: 4096,
  CODE_CHALLENGE: 128,
  SCOPE: 256,
  SCOPE_COUNT: 64,
  TOKEN: 16_384,
  EMAIL_TOKEN: 4096,
  CODE: 64,
  ACTIVATION_CODE_LENGTH: 6,
  SECOND_FACTOR_CODE_LENGTH: 6,
  RECOVERY_CODE: 24,
  PASSWORD_BYTES: MAX_PASSWORD_BYTES,
  FACTOR_COUNT: 4,
  PASSKEY_FIELD: 16_384,
  PASSKEY_CREDENTIAL_COUNT: 64,
  PASSKEY_TIMEOUT_MS: 120_000,
  ISO_DATE: 40,
} as const;

export const NATIVE_AUTH_PATTERN = {
  BASE64URL_SHA256: /^[A-Za-z0-9_-]{43}$/u,
  SHA256_HEX: /^[a-f0-9]{64}$/u,
  ISO_DATE: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/u,
  ACTIVATION_CODE: /^\d{6}$/u,
  SECOND_FACTOR_CODE: /^\d{6}$/u,
  RECOVERY_CODE: /^[A-Za-z2-7\s-]{10,24}$/u,
} as const;

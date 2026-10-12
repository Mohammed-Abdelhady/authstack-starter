import { hostCookieName } from '../../utils/cookie-name.util';

/** Which ceremony a challenge was handed out for. */
export type PasskeyChallengePurpose = 'register' | 'login';
export const PASSKEY_CHALLENGE_COOKIE = hostCookieName(
  process.env.NODE_ENV,
  'pk_challenge',
);

/** How long a challenge stays usable, in milliseconds. */
export const PASSKEY_CHALLENGE_TTL_MS = 300000;

/**
 * Label the challenge signing key is derived under. The same environment
 * secret signs the OAuth state cookie, and a key derived under one label
 * cannot verify a token signed under another.
 */
export const PASSKEY_CHALLENGE_HKDF_INFO = 'passkey-challenge';

/** Bytes of the derived signing key. */
export const PASSKEY_CHALLENGE_KEY_BYTES = 32;

/** Timeout the browser applies to the prompt, in milliseconds. */
export const PASSKEY_CEREMONY_TIMEOUT_MS = 60000;

/** Name given to a credential the client registered without one. */
export const PASSKEY_DEFAULT_NAME = 'Passkey';

/** Longest name a passkey may carry. */
export const PASSKEY_NAME_MAX_LENGTH = 64;

/** Longest base64url field the verify routes read before rejecting the body. */
export const PASSKEY_MAX_FIELD_LENGTH = 4096;

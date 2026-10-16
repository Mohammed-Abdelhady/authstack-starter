import { API_GLOBAL_PREFIX } from '../../../common/constants/http-routes';
import { hostCookieName } from '../../utils/cookie-name.util';

/** Which ceremony a challenge was handed out for. */
export type PasskeyChallengePurpose = 'register' | 'login' | 'nativeRegister';

/** The ceremonies a browser challenge cookie is handed out for. */
export type BrowserChallengePurpose = Exclude<
  PasskeyChallengePurpose,
  'nativeRegister'
>;

const PASSKEYS_ROUTE = `^/(?:${API_GLOBAL_PREFIX}/)?auth/passkeys/`;

/** The browser routes that spend a challenge, by the ceremony each spends. */
export const PASSKEY_VERIFY_ROUTES: Readonly<
  Record<BrowserChallengePurpose, RegExp>
> = {
  login: new RegExp(`${PASSKEYS_ROUTE}login/verify/?$`, 'u'),
  register: new RegExp(`${PASSKEYS_ROUTE}register/verify/?$`, 'u'),
};

/** What a ceremony asks of the authenticator before it signs. */
export const USER_VERIFICATION = {
  REQUIRED: 'required',
  PREFERRED: 'preferred',
} as const;

export type UserVerificationRequirement =
  (typeof USER_VERIFICATION)[keyof typeof USER_VERIFICATION];

/** Which route a registration ceremony runs on. */
export const PASSKEY_CEREMONY = {
  NATIVE: 'native',
  BROWSER: 'browser',
} as const;

export type PasskeyCeremony =
  (typeof PASSKEY_CEREMONY)[keyof typeof PASSKEY_CEREMONY];

/**
 * A registration made in an app reads neither browser rule: enrolment is
 * browser-only, and the native ceremony verifies its user anyway.
 */
export const NATIVE_REGISTRATION_POLICY = {
  requirePasskey: false,
  enrolment: false,
} as const;

/** Label that keeps a native registration digest apart from any other. */
export const NATIVE_REGISTRATION_DIGEST_LABEL = 'native-passkey-register';
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

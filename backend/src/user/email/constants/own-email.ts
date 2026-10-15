/** What the own email routes answer, in English for the logs and the API. */
export const OWN_EMAIL_MESSAGE = {
  REQUESTED:
    'If the address can be used, a code is on its way to it. Enter it here to finish the change.',
  CONFIRMED:
    'Your email address was changed. Other devices were signed out; this one stays signed in.',
  CANCELLED: 'The pending email change was cancelled.',
  SAME_ADDRESS: 'This is already the email address on your account',
  CHANGED_MEANWHILE:
    'The email address on your account changed while this request was prepared',
  LIMIT_REACHED: 'Too many codes were sent to this address. Try again later.',
  SESSION_ENDED: 'Current session is no longer active',
  SIGN_IN_AGAIN: 'Sign in again to change your email address',
  PASSWORD_REQUIRED: 'Enter your password to change your email address',
  CLIENT_REFUSED: 'This application cannot confirm an email address',
} as const;

/** The field a refused address is reported against. */
export const OWN_EMAIL_FIELD = 'email';

/** What proved the caller may steer the address in this request. */
export const OWN_EMAIL_PROOF = {
  /** A browser sign-in from the last five minutes, held by the session. */
  SESSION: 'session',
  /** The account's password, sent with the request. */
  PASSWORD: 'password',
} as const;

/** The longest password the proof reads, as the other password checks take. */
export const OWN_EMAIL_PASSWORD_MAX_LENGTH = 128;

/** The longest client id the native routes read, as the methods route does. */
export const NATIVE_CLIENT_ID_MAX_LENGTH = 128;

export const SESSION_STATUS = {
  RESTORING: 'restoring',
  SIGNED_OUT: 'signedOut',
  SIGNED_IN: 'signedIn',
  REAUTH_REQUIRED: 'reauthRequired',
  STORAGE_BLOCKED: 'storageBlocked',
} as const;

export const AUTH_OPERATION = {
  NONE: 'none',
  AUTHORIZING: 'authorizing',
  EXCHANGING: 'exchanging',
  REFRESHING: 'refreshing',
  SIGNING_OUT: 'signingOut',
} as const;

export const AUTH_REASON = {
  STORAGE_FAILURE: 'storageFailure',
  STORAGE_LOCKED: 'storageLocked',
  INVALID_RECORD: 'invalidRecord',
  INSTALL_MISMATCH: 'installMismatch',
  REFRESH_INTERRUPTED: 'refreshInterrupted',
  OAUTH_FAILURE: 'oauthFailure',
  DISABLED: 'disabled',
  PROFILE_FAILURE: 'profileFailure',
  AUTHORIZATION_DENIED: 'authorizationDenied',
  DEVICE_KEY_UNAVAILABLE: 'deviceKeyUnavailable',
  DEVICE_KEY_INVALIDATED: 'deviceKeyInvalidated',
  DEVICE_BINDING_REQUIRED: 'deviceBindingRequired',
} as const;

export const AUTH_SCHEMA_VERSION = 1;
export const PKCE_VERIFIER_BYTES = 32;
export const OAUTH_STATE_BYTES = 16;
export const SESSION_LINEAGE_BYTES = 16;
export const DPOP_JTI_BYTES = 16;
/**
 * Nonce challenges answered in one exchange, refresh or revoke. The server sends a
 * challenge before it reads the token, so answering one spends nothing. The limit
 * only ends a server that never stops challenging.
 */
export const DPOP_CHALLENGES_ANSWERED_MAX = 2;
export const MIN_OAUTH_STATE_CHARACTERS = Math.ceil((OAUTH_STATE_BYTES * 8) / 6);
export const AUTHORIZATION_CODE_LIFETIME_MS = 60_000;
export const PENDING_AUTHORIZATION_LIFETIME_MS = 5 * 60_000;
export const BROWSER_AUTHORIZATION_TIMEOUT_MS =
  PENDING_AUTHORIZATION_LIFETIME_MS + AUTHORIZATION_CODE_LIFETIME_MS;
export const NATIVE_ATTEMPT_LIFETIME_MS = 15 * 60_000;
export const INSTALL_IDENTITY_TIMEOUT_MS = 5_000;
export const CRYPTO_RANDOM_TIMEOUT_MS = 5_000;
export const CRYPTO_DIGEST_TIMEOUT_MS = 5_000;
export const DEVICE_KEY_TIMEOUT_MS = 5_000;
export const CALLBACK_READ_TIMEOUT_MS = 5_000;
export const CREDENTIAL_READ_TIMEOUT_MS = 5_000;
export const DISPOSED_RECORD_READ_ATTEMPTS = 2;
export const DISPOSED_RECORD_READ_ATTEMPT_TIMEOUT_MS =
  CREDENTIAL_READ_TIMEOUT_MS / DISPOSED_RECORD_READ_ATTEMPTS;
export const CREDENTIAL_WRITE_TIMEOUT_MS = 5_000;
export const CREDENTIAL_DELETE_TIMEOUT_MS = 4_000;
export const OAUTH_EXCHANGE_TIMEOUT_MS = 15_000;
export const PROFILE_READ_TIMEOUT_MS = 15_000;
export const OAUTH_REFRESH_TIMEOUT_MS = 15_000;
export const REFRESH_THROTTLE_BACKOFF_MS = 30_000;
export const ACCESS_TOKEN_SAFETY_MARGIN_MS = 30_000;
export const SIGN_OUT_REVOKE_TIMEOUT_MS = 5000;
export const MAX_CALLBACK_LENGTH = 4096;
export const AUTHORIZE_PATH = '/api/oauth/authorize';
export const DISABLED_OAUTH_DESCRIPTION = 'NATIVE_AUTH_DISABLED';
/** The same switch, as an API route spells it in a 403. */
export const NATIVE_AUTH_DISABLED_CODE = 'NATIVE_AUTH_DISABLED';
export const AUTHORITY_UNAVAILABLE_CODE = 'AUTHORITY_UNAVAILABLE';
export const RATE_LIMIT_EXCEEDED_CODE = 'RATE_LIMIT_EXCEEDED';
export const MAX_QUEUED_CALLBACKS = 16;
export const PORT_OPERATION = {
  CREDENTIALS_READ: 'credentials.read',
  CREDENTIALS_REPLACE: 'credentials.replace',
  CREDENTIALS_DELETE: 'credentials.delete',
  INSTALL_IDENTITY: 'install.identity',
  CRYPTO_RANDOM_BYTES: 'crypto.randomBytes',
  CRYPTO_SHA256: 'crypto.sha256',
  CALLBACK_INITIAL_ADDRESS: 'callbacks.initialAddress',
  DEVICE_KEY_PUBLIC_KEY: 'deviceKey.publicKey',
  DEVICE_KEY_SIGN: 'deviceKey.sign',
} as const;
export const NATIVE_DPOP_REQUIRED_REASON = 'NATIVE_DPOP_REQUIRED';
export const NATIVE_DPOP_RETRY_IN_PROGRESS_REASON = 'NATIVE_DPOP_RETRY_IN_PROGRESS';
export const DISPOSED_RECORD_OWNER = {
  OWN_SAME: 'OWN_SAME',
  OWN_OTHER: 'OWN_OTHER',
  FOREIGN: 'FOREIGN',
  EMPTY: 'EMPTY',
  UNREADABLE: 'UNREADABLE',
} as const;
export const DISALLOWED_REDIRECT_URI_SCHEMES: ReadonlySet<string> = new Set([
  'javascript',
  'data',
  'vbscript',
  'blob',
  'file',
  'ftp',
  'ws',
  'wss',
]);
export const UTF8_REPLACEMENT_CODE_POINT = 0xfffd;

export const STORE_CONDITION = {
  LOCKED: 'locked',
  CANCELLED: 'cancelled',
  UNAVAILABLE: 'unavailable',
} as const;
export const CREDENTIAL_WRITE_DONE = 'done';
export const LAUNCH_ADDRESS = {
  ADDRESS: 'address',
  NONE: 'none',
  UNAVAILABLE: 'unavailable',
} as const;
export const REFRESH_OUTCOME = {
  DISPOSED: 'disposed',
  REFRESHED: 'refreshed',
  NOT_SIGNED_IN: 'notSignedIn',
  FAILED: 'failed',
} as const;

export const REVOKE_OUTCOME = {
  NOT_NEEDED: 'notNeeded',
  REVOKED: 'revoked',
  FAILED: 'failed',
  TIMED_OUT: 'timedOut',
} as const;

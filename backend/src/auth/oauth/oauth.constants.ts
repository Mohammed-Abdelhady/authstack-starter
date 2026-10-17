/** Multi-provider injection token holding every registered strategy. */
export const OAUTH_STRATEGIES = 'OAUTH_STRATEGIES';

/** State cookies are named `oauth_<application>_<provider>`, behind `__Host-` in production. */
export const OAUTH_STATE_COOKIE_PREFIX = 'oauth_';

/** How long a start request stays valid, in milliseconds. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** Bound on provider token, profile and JWKS HTTP. */
export const OAUTH_HTTP_TIMEOUT_MS = 10_000;

/**
 * Closed set of reasons an OAuth failure log may carry. Provider text is
 * never quoted; an operator reads the reason, the HTTP status when there
 * is one, and codes the standards define.
 */
export enum OAuthFailureReason {
  HTTP_STATUS = 'http_status',
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  MALFORMED_RESPONSE = 'malformed_response',
  MISSING_NONCE = 'missing_nonce',
  CLIENT_SECRET_SIGNING = 'client_secret_signing',
  NO_ACCESS_TOKEN = 'no_access_token',
  NO_ID_TOKEN = 'no_id_token',
  NO_EMAIL = 'no_email',
  SUBJECT_MISMATCH = 'subject_mismatch',
  INVALID_TOKEN = 'invalid_token',
  PROVIDER_ERROR = 'provider_error',
  UNEXPECTED = 'unexpected',
}

/** Provider `error` fields a log may quote: the RFC 6749 codes. */
export const RFC6749_ERROR_CODES = [
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type',
  'invalid_scope',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
] as const;

export const OAUTH_UNLISTED_PROVIDER_CODE = 'unlisted';

/** A jose library error carries one of these machine codes, not free text. */
export const JOSE_ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;

/** Minimum length of OAUTH_STATE_SECRET. */
export const OAUTH_STATE_SECRET_MIN_LENGTH = 32;

/** Path the client handles after the backend callback. */
export const OAUTH_CLIENT_CALLBACK_PATH = '/auth/oauth/callback';

export const HTTP_METHOD = {
  GET: 'GET',
  POST: 'POST',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
} as const;

export type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];

/** Status assumed for a body that arrives without its response, as in RTK Query. */
export const HTTP_STATUS_OK = 200;

export const SUCCESS_STATUS_MIN = 200;
export const SUCCESS_STATUS_MAX = 299;

/** `grant_type` values POST /api/oauth/token accepts. */
export const OAUTH_GRANT_TYPE = {
  AUTHORIZATION_CODE: 'authorization_code',
  REFRESH_TOKEN: 'refresh_token',
} as const;

export const OAUTH_TOKEN_TYPE = 'Bearer';
export const OAUTH_DPOP_TOKEN_TYPE = 'DPoP';
export type OAuthTokenType = typeof OAUTH_TOKEN_TYPE | typeof OAUTH_DPOP_TOKEN_TYPE;

export const DPOP_PROOF_HEADER = 'DPoP';
export const DPOP_NONCE_HEADER = 'DPoP-Nonce';

/** Failure strings the raw OAuth routes answer with, as `{ error }`. */
export const OAUTH_ERROR = {
  INVALID_REQUEST: 'invalid_request',
  INVALID_CLIENT: 'invalid_client',
  INVALID_GRANT: 'invalid_grant',
  INVALID_DPOP_PROOF: 'invalid_dpop_proof',
  UNAUTHORIZED_CLIENT: 'unauthorized_client',
  UNSUPPORTED_GRANT_TYPE: 'unsupported_grant_type',
  UNSUPPORTED_RESPONSE_TYPE: 'unsupported_response_type',
  INVALID_SCOPE: 'invalid_scope',
  ACCESS_DENIED: 'access_denied',
  USE_DPOP_NONCE: 'use_dpop_nonce',
} as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR)[keyof typeof OAUTH_ERROR];

/** Why no response was received. */
export const TRANSPORT_FAILURE = {
  /** Offline, DNS, TLS or a timeout: the request may be worth retrying. */
  NO_RESPONSE: 'no_response',
  /** The caller's signal aborted the request. */
  ABORTED: 'aborted',
} as const;

export type TransportFailure = (typeof TRANSPORT_FAILURE)[keyof typeof TRANSPORT_FAILURE];

export const TRANSPORT_FAILURE_MESSAGE: Record<TransportFailure, string> = {
  [TRANSPORT_FAILURE.NO_RESPONSE]: 'No response was received',
  [TRANSPORT_FAILURE.ABORTED]: 'The request was aborted',
};

/** Path segments a URL parser would resolve away or drop. */
export const UNSAFE_PATH_SEGMENTS: ReadonlySet<string> = new Set(['', '.', '..']);

/** Language-neutral kinds on the session-list wire. */
export const DEVICE_KIND = {
  BROWSER: 'browser',
  MOBILE_APP: 'mobileApp',
  UNKNOWN: 'unknown',
} as const;

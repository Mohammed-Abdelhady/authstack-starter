export const SESSION_LAST_USED_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

/** OpenAPI security scheme for the HttpOnly session cookie. */
export const SESSION_SWAGGER_AUTH_NAME = 'session-auth';

/** Language-neutral kinds on the session-list wire. */
export const DEVICE_KIND = {
  BROWSER: 'browser',
  MOBILE_APP: 'mobileApp',
  UNKNOWN: 'unknown',
} as const;

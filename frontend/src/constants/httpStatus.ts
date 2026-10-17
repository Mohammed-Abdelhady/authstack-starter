/** HTTP statuses the client treats specially. */
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  REQUEST_TIMEOUT: 408,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

/** Lowest status that counts as a successful response. */
export const SUCCESS_STATUS_MIN = 200;

/** First status past the successful range. */
export const SUCCESS_STATUS_MAX_EXCLUSIVE = 300;

/**
 * Error message keys
 */
export const ERROR_MESSAGES = {
  // Network errors
  NETWORK_ERROR: 'toast.error.networkError',
  TIMEOUT_ERROR: 'toast.error.timeoutError',

  // Authentication errors
  UNAUTHORIZED: 'toast.error.unauthorized',
  FORBIDDEN: 'toast.error.forbidden',

  // Validation errors
  VALIDATION_FAILED: 'toast.error.validationFailed',
  INVALID_INPUT: 'toast.error.invalidInput',

  // Server errors
  SERVER_ERROR: 'toast.error.serverError',
  SERVICE_UNAVAILABLE: 'toast.error.serviceUnavailable',

  // Generic
  UNKNOWN_ERROR: 'toast.error.unknownError',
} as const;

/**
 * Status code to message key mapping
 */
export const STATUS_CODE_MESSAGES: Record<number, string> = {
  // Client errors (4xx)
  400: ERROR_MESSAGES.VALIDATION_FAILED,
  401: ERROR_MESSAGES.UNAUTHORIZED,
  403: ERROR_MESSAGES.FORBIDDEN,
  404: 'toast.error.notFound',
  408: ERROR_MESSAGES.TIMEOUT_ERROR,
  422: ERROR_MESSAGES.INVALID_INPUT,
  429: 'toast.error.tooManyRequests',

  // Server errors (5xx)
  500: ERROR_MESSAGES.SERVER_ERROR,
  502: 'toast.error.badGateway',
  503: ERROR_MESSAGES.SERVICE_UNAVAILABLE,
  504: ERROR_MESSAGES.TIMEOUT_ERROR,
};

/**
 * Default toast durations in milliseconds
 */
export const TOAST_DURATION = {
  SUCCESS: 4000,
  ERROR: 5000,
  WARNING: 6000,
  INFO: 4000,
  LOADING: Infinity, // Must be manually dismissed
  CRITICAL_ERROR: Infinity, // Server errors require manual acknowledgment
  NETWORK_ERROR: 10000, // Time to check the connection
  TIMEOUT_ERROR: 8000,
} as const;

/**
 * Toast configuration defaults
 */
export const TOAST_CONFIG = {
  MAX_VISIBLE: 5,
  POSITION: 'bottom-right' as const,
  DEDUPLICATION_WINDOW: 5000, // 5 seconds
  CLEANUP_INTERVAL: 60000, // 1 minute
  MAX_CACHE_SIZE: 100,
} as const;

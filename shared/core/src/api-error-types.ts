/**
 * Backend API error response structure
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * RTK Query error structure
 */
export interface RtkQueryError {
  status: number | 'FETCH_ERROR' | 'PARSING_ERROR' | 'TIMEOUT_ERROR' | 'CUSTOM_ERROR';
  data?: ApiErrorResponse | { message?: string; error?: ApiErrorResponse['error'] };
  error?: string;
}

/**
 * Parsed API error with normalized fields
 */
export interface ParsedApiError {
  /** Error code from backend (e.g., 'INVALID_CREDENTIALS') */
  code: string;
  /** Original message from backend */
  message: string;
  /** Translation key for the error code */
  translationKey: string;
  /** HTTP status code if available */
  statusCode?: number | undefined;
  /** Additional error details */
  details?: Record<string, unknown> | undefined;
  /** Whether this is a validation error with field-level errors */
  isValidationError: boolean;
  /** Field-level validation errors if present */
  fieldErrors?: Record<string, string[]> | undefined;
}

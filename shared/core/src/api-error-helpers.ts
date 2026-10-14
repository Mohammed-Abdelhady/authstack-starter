import { ErrorCode, getErrorCodeTranslationKey, type ErrorCodeType } from './error-codes';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Field-level messages of a validation error, read from `details.fields` as
 * the server's exception filter writes it. Entries that are not a list of
 * strings are dropped.
 */
export function extractFieldErrors(details?: unknown): Record<string, string[]> | undefined {
  if (!isRecord(details)) {
    return undefined;
  }
  const validationDetails: { fields?: unknown } = details;
  if (!isRecord(validationDetails.fields)) {
    return undefined;
  }

  // No prototype: a field named `__proto__` must stay an ordinary key.
  const fieldErrors: Record<string, string[]> = Object.create(null);
  for (const [field, messages] of Object.entries(validationDetails.fields)) {
    if (isStringArray(messages)) {
      fieldErrors[field] = messages;
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
}

/**
 * Code for a response that carries none, by HTTP status. The 4xx rows are the
 * server's exception filter table; the drift spec compares the two.
 */
const STATUS_ERROR_CODES: ReadonlyMap<number, ErrorCodeType> = new Map<number, ErrorCodeType>([
  [400, ErrorCode.INVALID_INPUT],
  [401, ErrorCode.SESSION_INVALID],
  [403, ErrorCode.FORBIDDEN],
  [404, ErrorCode.NOT_FOUND],
  [409, ErrorCode.CONFLICT],
  [429, ErrorCode.RATE_LIMIT_EXCEEDED],
  [500, ErrorCode.INTERNAL_ERROR],
  [502, ErrorCode.INTERNAL_ERROR],
  [503, ErrorCode.INTERNAL_ERROR],
  [504, ErrorCode.INTERNAL_ERROR],
]);

/** The error code for an HTTP status, `UNKNOWN_ERROR` when the status has no row. */
export function getStatusErrorCode(statusCode?: number): ErrorCodeType {
  if (statusCode === undefined) {
    return ErrorCode.UNKNOWN_ERROR;
  }
  return STATUS_ERROR_CODES.get(statusCode) ?? ErrorCode.UNKNOWN_ERROR;
}

/**
 * Get translation key for HTTP status code
 */
export function getStatusCodeTranslationKey(statusCode?: number): string {
  return getErrorCodeTranslationKey(getStatusErrorCode(statusCode));
}

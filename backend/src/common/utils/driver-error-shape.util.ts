/**
 * Reads the shape of a failure a database driver raised, without loading the
 * driver. An adapter that leaves a failure as raised hands the global filter
 * one of these, and the filter answers it as it always has.
 */
import { MONGO_DUPLICATE_KEY_CODE } from '../constants/mongo-errors';

/** What a cast failure carries: the field, and the value that did not fit. */
export interface CastFailure {
  name: 'CastError';
  message?: string;
  path?: unknown;
  value?: unknown;
}

/**
 * Checks whether an exception is a cast failure: a value that could not be
 * read as the type its field stores.
 *
 * @param exception - Unknown exception
 * @returns True when the error is a CastError
 */
export function isCastError(exception: unknown): exception is CastFailure {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'name' in exception &&
    exception.name === 'CastError'
  );
}

/** A refused unique rule as the driver raises it. */
export interface DuplicateKeyFailure {
  code: number;
  message?: unknown;
  keyPattern?: Record<string, unknown>;
  keyValue?: Record<string, unknown>;
}

/**
 * Checks whether an exception is a duplicate key error (code 11000).
 *
 * @param exception - Unknown exception
 * @returns True when the error is code 11000
 */
export function isDuplicateKeyError(
  exception: unknown,
): exception is DuplicateKeyFailure {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'code' in exception &&
    exception.code === MONGO_DUPLICATE_KEY_CODE
  );
}

/**
 * Checks whether a duplicate key error targets the email field.
 *
 * @param exception - Unknown exception
 * @returns True when the duplicate key is email
 */
export function isDuplicateEmailError(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) {
    return false;
  }

  const err = exception as {
    keyPattern?: Record<string, unknown>;
    keyValue?: Record<string, unknown>;
    message?: unknown;
  };

  if (
    err.keyPattern &&
    Object.prototype.hasOwnProperty.call(err.keyPattern, 'email')
  ) {
    return true;
  }

  if (
    err.keyValue &&
    Object.prototype.hasOwnProperty.call(err.keyValue, 'email')
  ) {
    return true;
  }

  if (typeof err.message === 'string' && err.message.includes('email')) {
    return true;
  }

  return false;
}

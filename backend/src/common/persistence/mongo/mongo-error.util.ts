import { Error as MongooseError } from 'mongoose';
import {
  MongoNetworkError,
  MongoServerSelectionError,
  MongoServerError,
  MongoNotConnectedError,
  MongoTopologyClosedError,
  MongoWriteConcernError,
} from 'mongodb';
import {
  MONGO_UNAVAILABLE_CODES,
  MONGO_TRANSIENT_TRANSACTION_LABEL,
} from '../../constants/mongo-errors';
import {
  isCastError as hasCastErrorShape,
  isDuplicateEmailError,
  isDuplicateKeyError as hasDuplicateKeyShape,
} from '../../utils/driver-error-shape.util';
import { isUnknownTransactionOutcome } from '../../exceptions/unknown-transaction-outcome.error';

/**
 * True for outages, unknown commits and exhausted write conflicts; ordinary
 * database rejections and application errors keep their own status.
 */
export function isDatabaseUnavailableError(exception: unknown): boolean {
  if (isUnknownTransactionOutcome(exception)) {
    return true;
  }
  if (
    typeof exception === 'object' &&
    exception !== null &&
    'errorLabels' in exception &&
    Array.isArray(exception.errorLabels) &&
    exception.errorLabels.includes(MONGO_TRANSIENT_TRANSACTION_LABEL)
  ) {
    return true;
  }
  if (
    exception instanceof MongoNetworkError ||
    exception instanceof MongoServerSelectionError ||
    exception instanceof MongoNotConnectedError ||
    exception instanceof MongoTopologyClosedError ||
    exception instanceof MongoWriteConcernError
  ) {
    return true;
  }
  if (exception instanceof MongoServerError) {
    return (
      typeof exception.code === 'number' &&
      MONGO_UNAVAILABLE_CODES.has(exception.code)
    );
  }
  if (exception instanceof MongooseError.MongooseServerSelectionError) {
    return true;
  }
  return (
    exception instanceof MongooseError &&
    /buffering timed out/i.test(exception.message)
  );
}

/**
 * Checks whether an exception is a Mongoose CastError.
 *
 * @param exception - Unknown exception
 * @returns True when the error is a CastError
 */
export function isCastError(
  exception: unknown,
): exception is MongooseError.CastError {
  return hasCastErrorShape(exception);
}

/**
 * Checks whether an exception is a MongoDB duplicate key error (code 11000).
 *
 * @param exception - Unknown exception
 * @returns True when the error is code 11000
 */
export function isMongoDuplicateKeyError(
  exception: unknown,
): exception is MongoServerError {
  return hasDuplicateKeyShape(exception);
}

export { isDuplicateEmailError };

export {
  describeDriverError,
  errorToken,
} from '../../utils/describe-error.util';

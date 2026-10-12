import { HttpStatus, Logger } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { isUnknownTransactionOutcome } from '../../../common/exceptions/unknown-transaction-outcome.error';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { describeDriverError } from '../../../common/utils/describe-error.util';

const logger = new Logger('SessionAuthority');

export function throwIfAppException(error: unknown): void {
  if (error instanceof AppException) {
    throw error;
  }
}

export function asAuthorityUnavailable(error: unknown): never {
  throwIfAppException(error);
  if (isUnknownTransactionOutcome(error)) {
    logAuthorityFailure(error);
    throw new AppException(
      ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
      'The authentication transaction outcome is unknown',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  logAuthorityFailure(error);
  throw new AppException(
    ErrorCode.AUTHORITY_UNAVAILABLE,
    'Authentication authority is unavailable',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function logAuthorityFailure(error: unknown): void {
  logger.error(
    `Session authority operation failed: ${describeDriverError(error)}`,
  );
}

import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';

export function unauthorizedAttempt(): AppException {
  return new AppException(
    ErrorCode.INVALID_CREDENTIALS,
    'Native attempt credential invalid',
    HttpStatus.UNAUTHORIZED,
  );
}

export function expiredAttempt(): AppException {
  return new AppException(
    ErrorCode.NATIVE_TRANSACTION_EXPIRED,
    'Native attempt expired',
    HttpStatus.GONE,
  );
}

export function wrongStage(): AppException {
  return new AppException(
    ErrorCode.CONFLICT,
    'Native attempt state changed',
    HttpStatus.CONFLICT,
  );
}

export function featureDisabled(): AppException {
  return new AppException(
    ErrorCode.FEATURE_DISABLED,
    'Native sign-in unavailable',
    HttpStatus.NOT_FOUND,
  );
}

export function invalidRequest(): AppException {
  return new AppException(
    ErrorCode.VALIDATION_ERROR,
    'Invalid native request',
    HttpStatus.BAD_REQUEST,
  );
}

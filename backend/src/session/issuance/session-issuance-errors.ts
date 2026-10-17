import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';

export function accountNotFound(): AppException {
  return new AppException(
    ErrorCode.USER_NOT_FOUND,
    'User not found',
    HttpStatus.NOT_FOUND,
  );
}

export function grantBlocked(): AppException {
  return new AppException(
    ErrorCode.GRANT_BLOCKED,
    'Application access is blocked for this account',
    HttpStatus.FORBIDDEN,
  );
}

export function sessionLimitReached(): AppException {
  return new AppException(
    ErrorCode.SESSION_LIMIT_REACHED,
    'Session limit reached',
    HttpStatus.CONFLICT,
  );
}

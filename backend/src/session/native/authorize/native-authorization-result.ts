import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';

export function appendAuthorizationCode(
  redirectUri: string,
  code: string,
  state: string,
): string {
  const target = new URL(redirectUri);
  target.searchParams.set('code', code);
  target.searchParams.set('state', state);
  return target.toString();
}

export function expiredTransaction(): AppException {
  return new AppException(
    ErrorCode.NATIVE_TRANSACTION_EXPIRED,
    'Native authorization transaction is expired or already ended',
    HttpStatus.NOT_FOUND,
  );
}

export function incompleteApproval(): AppException {
  return new AppException(
    ErrorCode.VALIDATION_ERROR,
    'Authorization approval is incomplete',
    HttpStatus.BAD_REQUEST,
  );
}

import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';

export class AccountCreationRefusedError extends AppException {
  constructor() {
    super(
      ErrorCode.ACCOUNT_CREATION_REFUSED,
      'Account creation is not allowed',
      HttpStatus.FORBIDDEN,
    );
  }
}

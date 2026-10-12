import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';

/** A client may sign people in only when it is registered and enabled. */
export function requireEnabledApplication<
  Registered extends { enabled: boolean },
>(application: Registered | null | undefined): Registered {
  if (!application) {
    throw new AppException(
      ErrorCode.APPLICATION_NOT_FOUND,
      'Application is not registered',
      HttpStatus.NOT_FOUND,
    );
  }

  if (!application.enabled) {
    throw new AppException(
      ErrorCode.APPLICATION_DISABLED,
      'Application is disabled',
      HttpStatus.FORBIDDEN,
    );
  }

  return application;
}

import type { Request } from 'express';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';

export function rejectBrowserContext(request: Request): void {
  if (
    request.headers.origin !== undefined ||
    request.headers.cookie !== undefined
  ) {
    throw new AppException(
      ErrorCode.FORBIDDEN,
      'Browser context not accepted',
      403,
    );
  }
}

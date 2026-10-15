import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { storeFailureCause } from '../../../common/persistence/store-failure';

/** Creation and linking report the same provider identity conflict. */
export function toProviderLinkError(error: unknown, provider: string): unknown {
  if (!(error instanceof UniqueConflictError)) {
    return storeFailureCause(error);
  }

  return new AppException(
    ErrorCode.OAUTH_ACCOUNT_LINKED_ELSEWHERE,
    'This provider account is already linked to another user',
    HttpStatus.CONFLICT,
    { provider },
  );
}

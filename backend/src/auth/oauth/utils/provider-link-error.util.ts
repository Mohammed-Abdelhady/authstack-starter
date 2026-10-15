import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { AddressReservationTakenError } from '../../../common/persistence/address-reservation-taken.error';
import { storeFailureCause } from '../../../common/persistence/store-failure';

/** Address and provider identity conflicts keep their existing errors. */
export function toProviderLinkError(error: unknown, provider: string): unknown {
  if (error instanceof AddressReservationTakenError) {
    return providerAddressTaken(provider);
  }
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

export function providerAddressTaken(provider: string): AppException {
  return new AppException(
    ErrorCode.OAUTH_ACCOUNT_EXISTS,
    'An account with this address already exists. Sign in another way, then link this provider in the settings',
    HttpStatus.CONFLICT,
    { provider },
  );
}

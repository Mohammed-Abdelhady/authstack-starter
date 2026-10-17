import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { ValidationFailedException } from '../../../common/exceptions/validation-failed.exception';
import {
  isStoreOutage,
  storeFailureCause,
} from '../../../common/persistence/store-failure';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';
import {
  REAUTH_REQUIREMENT,
  reauthRequired,
} from '../../../auth/services/reauth/reauth.service';
import { OWN_EMAIL_FIELD, OWN_EMAIL_MESSAGE } from '../constants/own-email';

/**
 * The ledger answered "taken" after `isFree` said free. The unit of work must
 * roll back the claim it may have written, and the request is stored again as
 * one for a held address.
 */
export class AddressClaimLostError extends Error {
  constructor() {
    super('The address was claimed by another request first');
    this.name = 'AddressClaimLostError';
  }
}

export function sessionEnded(): AppException {
  return new AppException(
    ErrorCode.SESSION_INVALID,
    OWN_EMAIL_MESSAGE.SESSION_ENDED,
    HttpStatus.UNAUTHORIZED,
  );
}

export function signInAgain(): AppException {
  return reauthRequired(
    OWN_EMAIL_MESSAGE.SIGN_IN_AGAIN,
    REAUTH_REQUIREMENT.RECENT_SIGN_IN,
  );
}

/** Reported on the field, like any other refused value. */
export function sameAddress(): ValidationFailedException {
  return new ValidationFailedException(
    { [OWN_EMAIL_FIELD]: [OWN_EMAIL_MESSAGE.SAME_ADDRESS] },
    { fieldNames: [OWN_EMAIL_FIELD], omittedCount: 0 },
  );
}

export function changedMeanwhile(): AppException {
  return new AppException(
    ErrorCode.CONFLICT,
    OWN_EMAIL_MESSAGE.CHANGED_MEANWHILE,
    HttpStatus.CONFLICT,
  );
}

export function limitReached(): AppException {
  return new AppException(
    ErrorCode.EMAIL_SEND_LIMIT_REACHED,
    OWN_EMAIL_MESSAGE.LIMIT_REACHED,
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * A refusal keeps its own answer. A database that failed or went silent is an
 * unavailable authority, and a commit with no answer says so.
 */
export function asOwnEmailFailure(error: unknown): never {
  if (!isStoreOutage(error)) throw storeFailureCause(error);
  asAuthorityUnavailable(storeFailureCause(error));
}

export function clientRefused(): AppException {
  return new AppException(
    ErrorCode.FORBIDDEN,
    OWN_EMAIL_MESSAGE.CLIENT_REFUSED,
    HttpStatus.FORBIDDEN,
  );
}

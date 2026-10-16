import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { storedAddress } from '../../../common/persistence/stored-address';
import { INVITATION_INVALID_MESSAGE } from '../constants/invitations';
import type { StoredInvitation } from '../types/invitation';

export function invalidInvitation(): AppException {
  return new AppException(
    ErrorCode.INVITATION_INVALID,
    INVITATION_INVALID_MESSAGE,
    HttpStatus.BAD_REQUEST,
  );
}

export function requireOpenInvitation(
  invitation: StoredInvitation | null,
  now: Date,
): StoredInvitation {
  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    invitation.expiresAt.getTime() <= now.getTime()
  ) {
    throw invalidInvitation();
  }
  return invitation;
}

/** The account an enrolment link may sign in: still at the address and generation it was mailed for. */
export function requireEnrolmentAccount<
  Account extends {
    email: string;
    addressGeneration: number;
    isDeleted: boolean;
  },
>(invitation: StoredInvitation, account: Account | null): Account {
  if (
    !account ||
    account.isDeleted ||
    account.addressGeneration !== invitation.addressGeneration ||
    storedAddress(account.email) !== invitation.email
  ) {
    throw invalidInvitation();
  }
  return account;
}

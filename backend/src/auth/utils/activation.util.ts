import { Logger } from '@nestjs/common';
import { Response } from 'express';
import {
  ACCOUNT_RESERVATION_RESULT,
  ADDRESS_CLAIM_KIND,
  ADDRESS_CLAIM_RESULT,
  AddressLedger,
} from '../../common/persistence/address-ledger';
import { UniqueConflictError } from '../../common/persistence/persistence-errors';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { ActivateResponseDto } from '../dto/activate-response.dto';
import { ReservedCode } from '../interfaces/pending-code.interface';
import {
  ActivatedAccount,
  ActivationAccounts,
  ActivationSignIn,
} from '../pending-codes/activation-accounts';
import { activationCodeInvalid } from './activation-error.util';
import type { SupportedLocale } from '../../common/constants/locales';
import { AccountCreationPolicy } from '../services/registration/account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../constants/account-creation';

const logger = new Logger('Activation');

/**
 * Build the account a verified sign-up code describes, inside the caller's
 * unit of work. An address that already has an account wins the collision:
 * nothing is overwritten, nobody is signed in, and the answer is the shared
 * failure, so a sign-up never verifies, changes or signs into an account
 * because its address matches.
 *
 * @param accounts - The account store
 * @param unitOfWork - The unit of work the insert must join
 * @param reserved - The generation verifyCode compared
 * @param account - Password hash, name, the request's language, and the id
 *   generated before the unit of work, so an unknown commit can be resolved
 *   by looking this exact account up afterwards
 * @throws AppException ACTIVATION_CODE_INVALID when an account already exists
 */
export async function createActivatedAccount(
  accounts: ActivationAccounts,
  unitOfWork: UnitOfWork,
  reserved: ReservedCode,
  account: {
    id: string;
    passwordHash: string;
    name: string;
    locale: SupportedLocale;
  },
  policy: AccountCreationPolicy,
  application: string,
  ledger: AddressLedger,
  now: Date,
): Promise<ActivatedAccount> {
  if (await accounts.hasActiveAccount(unitOfWork, reserved.email)) {
    throw activationCodeInvalid();
  }

  await policy.assertMayCreate(
    { application, method: ACCOUNT_CREATION_METHOD.PASSWORD },
    unitOfWork,
  );
  const reservation = await ledger.reserveForAccount(unitOfWork, {
    address: reserved.email,
    now,
  });
  if (reservation.status === ACCOUNT_RESERVATION_RESULT.TAKEN) {
    throw activationCodeInvalid();
  }
  try {
    const created = await accounts.insertActivated(unitOfWork, {
      id: account.id,
      email: reserved.email,
      passwordHash: account.passwordHash,
      name: account.name,
      locale: account.locale,
    });
    await ledger.finishAccountReservation(unitOfWork, reservation.reservation);
    return created;
  } catch (error) {
    // A second account for the same address can win between the read and the
    // insert. The caller gets the shared failure and the unit of work rolls
    // back, so the code stays usable and no session is issued.
    if (error instanceof UniqueConflictError) {
      throw activationCodeInvalid();
    }
    throw error;
  }
}

/**
 * Put the account on the address an admin asked for, inside the unit of work
 * that consumed the code. Until here the account kept its previous address.
 * The record must still point at the same user and the same address
 * generation, so a superseded change confirms nothing. No session is issued:
 * the user signs in normally.
 *
 * @param accounts - The account store
 * @param unitOfWork - The unit of work the update must join
 * @param reserved - The generation verifyCode compared
 * @returns The address the account left, or null when it was already on the
 *   confirmed one
 * @throws AppException ACTIVATION_CODE_INVALID for a stale or missing target,
 *   or an address another account took meanwhile
 */
export async function confirmEmailChange(
  accounts: ActivationAccounts,
  unitOfWork: UnitOfWork,
  reserved: ReservedCode,
  ledger: AddressLedger,
  now: Date,
  lapsesAt: Date,
): Promise<string | null> {
  if (!reserved.userId) {
    throw activationCodeInvalid();
  }

  const user = await accounts.readMovedAccount(
    unitOfWork,
    reserved.userId.toString(),
  );

  if (
    !user ||
    user.addressGeneration !== (reserved.addressGeneration ?? 0) ||
    user.pendingEmail !== reserved.email
  ) {
    throw activationCodeInvalid();
  }

  const claimed = await ledger.claim(unitOfWork, {
    address: reserved.email,
    owner: reserved.userId.toString(),
    kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
    now,
    lapsesAt,
  });
  if (claimed === ADDRESS_CLAIM_RESULT.TAKEN) throw activationCodeInvalid();
  const previous = user.email;
  try {
    await accounts.confirmAddress(unitOfWork, user, reserved.email);
    await ledger.release(unitOfWork, {
      address: reserved.email,
      owner: reserved.userId.toString(),
    });
  } catch (error) {
    if (error instanceof UniqueConflictError) {
      throw activationCodeInvalid();
    }
    throw error;
  }
  return previous === reserved.email ? null : previous;
}

/**
 * Run the sign-in every other sign-in route runs, so two-step sign-in rules
 * apply after activation. The account is already committed here; a failed
 * sign-in must not read as a failed activation, so the caller is asked to sign
 * in normally instead.
 *
 * @param signIn - The shared sign-in path
 * @param account - The committed account
 * @param response - Response the session cookie is set on
 */
export async function finishActivation(
  signIn: ActivationSignIn,
  account: ActivatedAccount,
  response: Response,
): Promise<ApiResponse<ActivateResponseDto>> {
  try {
    const outcome = await signIn.complete(account, response);
    if (outcome.requiresTwoFactor) {
      return ActivateResponseDto.twoFactorRequired();
    }
    return ActivateResponseDto.success(outcome.user);
  } catch (error) {
    const cause = error instanceof Error ? error.name : typeof error;
    logger.error(
      `Sign-in after activation failed for user ${account.id} cause=${cause}`,
    );
    return ActivateResponseDto.signInRequired();
  }
}

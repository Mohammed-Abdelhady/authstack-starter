import { Response } from 'express';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { SignInOutcome } from '../interfaces/authenticated-user.interface';

/** Shared names of the unique rules an activation can run into. */
export const ACTIVATION_CONSTRAINT = {
  ADDRESS: 'user.email',
} as const;

/** Who holds an address today, deactivated accounts included. */
export interface AddressOwner {
  name: string;
  isDeleted: boolean;
}

export interface NewActivatedAccount {
  /** Made by `newAccountId` before the unit of work started. */
  id: string;
  email: string;
  passwordHash: string;
  name: string;
}

/**
 * An account an activation just stored. Only the adapter that stored it can
 * look inside, so the service can hand it to the sign-in and nothing else.
 */
export abstract class ActivatedAccount {
  abstract readonly id: string;
}

/** An account whose moved address a code is about to confirm. */
export abstract class MovedAccount {
  abstract readonly email: string;
  abstract readonly addressGeneration: number;
}

/** What a commit with no answer is resolved against. */
export interface AddressConfirmation {
  isVerified: boolean;
  addressGeneration: number;
}

/**
 * The account side of the two code flows that write an account: activating a
 * sign-up and confirming an address an admin moved. The methods that take a
 * unit of work commit or roll back with the code they spend.
 */
export abstract class ActivationAccounts {
  /** An id for an account that does not exist yet. */
  abstract newAccountId(): string;
  abstract findAddressOwner(email: string): Promise<AddressOwner | null>;
  /** Whether the account with this id was stored. */
  abstract isStored(accountId: string): Promise<boolean>;
  abstract findAddressConfirmation(
    userId: string,
  ): Promise<AddressConfirmation | null>;

  /** True when an account that is not deactivated has the address. */
  abstract hasActiveAccount(
    unitOfWork: UnitOfWork,
    email: string,
  ): Promise<boolean>;
  /**
   * Stores a verified account with a password. An address another request
   * took first is a `UniqueConflictError`.
   */
  abstract insertActivated(
    unitOfWork: UnitOfWork,
    account: NewActivatedAccount,
  ): Promise<ActivatedAccount>;
  /** The account with this id, unless it is deactivated. */
  abstract readMovedAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<MovedAccount | null>;
  abstract markAddressVerified(
    unitOfWork: UnitOfWork,
    account: MovedAccount,
  ): Promise<void>;
}

export type ActivationSignInOutcome = SignInOutcome;

/** The sign-in every other route runs, for an account just activated. */
export abstract class ActivationSignIn {
  abstract complete(
    account: ActivatedAccount,
    response: Response,
  ): Promise<ActivationSignInOutcome>;
}

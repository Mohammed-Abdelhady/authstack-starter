import { Response } from 'express';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { SignInOutcome } from '../interfaces/authenticated-user.interface';
import type { SupportedLocale } from '../../common/constants/locales';

/** Shared names of the unique rules an activation can run into. */
export const ACTIVATION_CONSTRAINT = {
  ADDRESS: 'user.email',
} as const;

/** Who holds an address today, deactivated accounts included. */
export interface AddressOwner {
  name: string;
  isDeleted: boolean;
  /** The language the owner's mail is written in. */
  locale: SupportedLocale;
}

export interface NewActivatedAccount {
  /** Made by `newAccountId` before the unit of work started. */
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  /** The language of the request that activates it. */
  locale: SupportedLocale;
}

/**
 * An account an activation just stored. Only the adapter that stored it can
 * look inside, so the service can hand it to the sign-in and nothing else.
 */
export abstract class ActivatedAccount {
  abstract readonly id: string;
}

/** An account whose pending address a code is about to confirm. */
export abstract class MovedAccount {
  abstract readonly email: string;
  abstract readonly pendingEmail: string | undefined;
  abstract readonly addressGeneration: number;
  /** The language the account's mail is written in. */
  abstract readonly locale: SupportedLocale;
}

/** What a commit with no answer is resolved against. */
export interface AddressConfirmation {
  email: string;
  pendingEmail?: string;
  isVerified: boolean;
  addressGeneration: number;
  locale: SupportedLocale;
}

/**
 * The address an account asked to move to, or none, at the generation that
 * kills every code issued before it.
 */
export interface OwnPendingAddress {
  email: string | null;
  addressGeneration: number;
}

/**
 * The account side of the code flows that write an account: activating a
 * sign-up, and asking for and confirming a new address. The methods that take a
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
  /**
   * Puts the account on the confirmed address, clears its pending address,
   * and marks it verified. An
   * address another account took first is a `UniqueConflictError`.
   */
  abstract confirmAddress(
    unitOfWork: UnitOfWork,
    account: MovedAccount,
    email: string,
  ): Promise<void>;
  /**
   * The account's own change, beside the staff one: stores or clears the
   * pending address of an account read with `readMovedAccount`.
   */
  abstract savePendingAddress(
    unitOfWork: UnitOfWork,
    account: MovedAccount,
    pending: OwnPendingAddress,
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

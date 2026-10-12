import { Response } from 'express';
import { AuthenticatedUserSummary } from '../../interfaces/authenticated-user.interface';

/** An account as the passkey routes need it. */
export interface PasskeyAccount {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly isDeleted: boolean;
}

/** The ways into an account that are stored on the account itself. */
export interface StoredSignInMethods {
  hasPassword: boolean;
  hasLinkedAccount: boolean;
}

/** What re-authentication reads of an account. */
export interface PasskeyAccountPassword {
  /** Absent on an account that signs in without a password. */
  readonly passwordHash?: string;
}

/** The accounts passkeys are registered to and sign in. */
export abstract class PasskeyAccounts {
  /** The account with this id, deactivated ones included. */
  abstract findAccount(userId: string): Promise<PasskeyAccount | null>;
  /** The password hash of the account, for the check before a passkey is added. */
  abstract findPassword(userId: string): Promise<PasskeyAccountPassword | null>;
  abstract findSignInMethods(
    userId: string,
  ): Promise<StoredSignInMethods | null>;
}

export type PasskeySignInOutcome =
  | { requiresTwoFactor: true }
  | { requiresTwoFactor: false; user: AuthenticatedUserSummary };

/** The shared sign-in, for an account a passkey just proved. */
export abstract class PasskeySignIn {
  /** Issues the session with no second factor check. */
  abstract issueSession(
    account: PasskeyAccount,
    response: Response,
  ): Promise<AuthenticatedUserSummary>;
  /**
   * The sign-in every other route runs, second factor included, for a passkey
   * that did not verify its user. A sign-in it holds is told a passkey opened
   * it.
   */
  abstract completeSignIn(
    account: PasskeyAccount,
    response: Response,
  ): Promise<PasskeySignInOutcome>;
}

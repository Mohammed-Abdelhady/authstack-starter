import { StoredAccount } from '../../user/stores/stored-account';

/** An account a password is about to be checked against. */
export interface PasswordCandidate {
  account: StoredAccount;
  /** Absent for an account that signs in some other way only. */
  passwordHash?: string;
}

/**
 * What password sign-in and the password reset need of accounts. Every method
 * is one statement that commits by itself: none of these routes runs an atomic
 * workflow on the account. A deactivated account is never found.
 *
 * Each method costs the same whether or not the address has an account, which
 * the routes rely on to answer both alike.
 */
export abstract class PasswordSignInStore {
  /** The active account with this address, and its password hash. */
  abstract findForPasswordCheck(
    email: string,
  ): Promise<PasswordCandidate | null>;

  /** The active account with this address. The hash stays stored. */
  abstract findActiveByAddress(email: string): Promise<StoredAccount | null>;

  /** Stores a new hash on an account `findActiveByAddress` returned. */
  abstract storeNewPassword(
    account: StoredAccount,
    passwordHash: string,
  ): Promise<void>;
}

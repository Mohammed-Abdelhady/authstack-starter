import { UnitOfWork } from '../../common/persistence/unit-of-work';

/** The ways into an account as they are stored, read while they are held. */
export interface HeldSignInMethods {
  /** The account was created to sign in by email. */
  readonly emailSignIn: boolean;
  readonly hasPassword: boolean;
  /** The provider of every linked account, in the order they were linked. */
  readonly linkedProviders: string[];
  readonly passkeys: number; // feature:passkeys
}

/**
 * The one fence every removal of a way to sign in passes. Whatever removes a
 * way in takes it first, in the unit of work that removes it.
 */
export abstract class SignInMethodStore {
  /**
   * Reads the account's ways in and holds them until the unit of work ends.
   * No other unit of work can hold them meanwhile: a second one that tries is
   * refused at once with a retryable abort, runs again, and reads what is
   * left then. Null when no account has this id.
   */
  abstract holdForAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<HeldSignInMethods | null>;

  /**
   * Reads the account's ways in and holds nothing. What it answers can be out
   * of date by the time it is used, so it is for advice, never for a removal.
   */
  abstract readForAccount(userId: string): Promise<HeldSignInMethods | null>;
}

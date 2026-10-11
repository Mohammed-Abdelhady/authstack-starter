import { Response } from 'express';
import { AuthenticatedUserSummary } from '../../interfaces/authenticated-user.interface';

/** Shared names of the unique rules creating an account can run into. */
export const MAGIC_LINK_ACCOUNT_CONSTRAINT = {
  ADDRESS: 'user.email',
} as const;

/**
 * An account as the link flow sees it. Only the adapter that read it can look
 * inside, so the service can pass it on and nothing else.
 */
export abstract class MagicLinkAccount {
  abstract readonly id: string;
  abstract readonly isDeleted: boolean;
  abstract readonly isVerified: boolean;
}

export interface NewPasswordlessAccount {
  email: string;
  name: string;
}

/**
 * The account reads and writes a link needs. They are the same single
 * statements, each committed by itself, that the flow made before the seam:
 * spending a link and writing its account were never one transaction.
 */
export abstract class MagicLinkAccounts {
  /** The account with this address, deleted ones included. */
  abstract findByEmail(email: string): Promise<MagicLinkAccount | null>;

  /**
   * True when the address belongs to a deleted account. One statement of the
   * same size whether or not any account has the address.
   */
  abstract hasDeletedAccount(email: string): Promise<boolean>;

  abstract markVerified(account: MagicLinkAccount): Promise<void>;

  /**
   * Stores a verified account with no password. An address another request
   * took first is a `UniqueConflictError`.
   */
  abstract createPasswordless(
    account: NewPasswordlessAccount,
  ): Promise<MagicLinkAccount>;
}

export type MagicLinkSignInOutcome =
  | { requiresTwoFactor: true }
  | { requiresTwoFactor: false; user: AuthenticatedUserSummary };

/** The sign-in every other route runs, for an account a link proved. */
export abstract class MagicLinkSignIn {
  abstract complete(
    account: MagicLinkAccount,
    response: Response,
  ): Promise<MagicLinkSignInOutcome>;
}

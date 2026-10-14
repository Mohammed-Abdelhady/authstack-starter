import { Response } from 'express';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { SignInOutcome } from '../../interfaces/authenticated-user.interface';
import type { SupportedLocale } from '../../../common/constants/locales';

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
  /** The language of the request that spends the link. */
  locale: SupportedLocale;
}

/** What a link request needs to know of the account behind an address. */
export interface LinkRecipient {
  isDeleted: boolean;
  /** The language the account's mail is written in. */
  locale: SupportedLocale;
}

/**
 * Account creation joins the caller's transaction. Link claiming remains a
 * separate write, so refusing creation does not make a spent link reusable.
 */
export abstract class MagicLinkAccounts {
  /** The account with this address, deleted ones included. */
  abstract findByEmail(email: string): Promise<MagicLinkAccount | null>;
  abstract findByEmailIn(
    unitOfWork: UnitOfWork,
    email: string,
  ): Promise<MagicLinkAccount | null>;

  /**
   * Whether the account at the address is deleted, and its language. One
   * statement of the same size whether or not any account has the address.
   */
  abstract findLinkRecipient(email: string): Promise<LinkRecipient | null>;

  abstract markVerified(account: MagicLinkAccount): Promise<void>;
  abstract markVerifiedIn(
    unitOfWork: UnitOfWork,
    account: MagicLinkAccount,
  ): Promise<boolean>;

  /**
   * Stores a verified account with no password. An address another request
   * took first is a `UniqueConflictError`.
   */
  abstract createPasswordlessIn(
    unitOfWork: UnitOfWork,
    account: NewPasswordlessAccount,
  ): Promise<MagicLinkAccount>;
}

export type MagicLinkSignInOutcome = SignInOutcome;

/** The sign-in every other route runs, for an account a link proved. */
export abstract class MagicLinkSignIn {
  abstract complete(
    account: MagicLinkAccount,
    response: Response,
  ): Promise<MagicLinkSignInOutcome>;
}

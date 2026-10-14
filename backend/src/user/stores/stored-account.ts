import { EMAIL_PROVIDER } from '../../common/constants/oauth-providers';
import type { SupportedLocale } from '../../common/constants/locales';

/** Shared names of the unique rules an account write can run into. */
export const ACCOUNT_CONSTRAINT = {
  EMAIL: 'user.email',
  LINKED_IDENTITY: 'user.linked_account',
} as const;

export interface LinkedAccountRecord {
  provider: string;
  providerId: string;
  linkedAt: Date;
}

/**
 * An account as a store read it. A write takes the record back, so a store may
 * write through what it read. A field the read did not ask for is at its
 * default here, not at its stored value.
 */
export interface StoredAccount {
  readonly id: string;
  readonly email: string;
  readonly pendingEmail?: string;
  readonly name: string;
  readonly avatarUrl?: string;
  readonly role: string;
  readonly permissions: string[];
  readonly authProvider: string;
  readonly linkedAccounts: LinkedAccountRecord[];
  /** 'email' when password sign-in applies, then every linked provider. */
  readonly linkedProviders: string[];
  readonly isVerified: boolean;
  readonly isDeleted: boolean;
  readonly deletedAt?: Date;
  readonly sessionVersion: number;
  readonly addressGeneration: number;
  readonly primaryProvider?: string;
  readonly profileSyncedAt?: Date;
  readonly lastSyncedProvider?: string;
  /** The language the account's mail is written in. */
  readonly locale: SupportedLocale;
  readonly twoFactorEnabled: boolean; // feature:totp
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The sign-in methods an account has, in the order they are reported. */
export function linkedProvidersOf(account: {
  authProvider: string;
  linkedAccounts: Pick<LinkedAccountRecord, 'provider'>[];
}): string[] {
  const providers = account.linkedAccounts.map(({ provider }) => provider);
  return account.authProvider === EMAIL_PROVIDER
    ? [EMAIL_PROVIDER, ...providers]
    : providers;
}

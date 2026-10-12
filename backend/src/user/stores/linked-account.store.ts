import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { StoredAccount } from './stored-account';

/**
 * The sign-in methods of an account. The read does not ask for the
 * deactivation: a caller that must refuse a deactivated account reads the
 * account.
 */
export interface LinkedProviders {
  linkedProviders: string[];
}

export interface PrimaryProviderState {
  isDeleted: boolean;
  primaryProvider?: string;
}

export interface SyncStatus {
  profileSyncedAt?: Date;
  lastSyncedProvider?: string;
  primaryProvider?: string;
}

export interface SyncedProfile {
  name?: string;
  avatarUrl?: string;
  profileSyncedAt: Date;
  lastSyncedProvider: string;
}

/**
 * Provider accounts linked to an account, and the profile a provider feeds.
 *
 * One provider identity belongs to one account. A link that would give it to
 * a second one is refused with a unique conflict named
 * `ACCOUNT_CONSTRAINT.LINKED_IDENTITY`. How the links are stored is the
 * adapter's business: a caller never assumes they are written with the account.
 */
export abstract class LinkedAccountStore {
  abstract findAccount(userId: string): Promise<StoredAccount | null>;
  /** The account with its links and nothing else but its deactivation. */
  abstract findLinks(userId: string): Promise<StoredAccount | null>;
  abstract findLinkedProviders(userId: string): Promise<LinkedProviders | null>;
  abstract findPrimaryProviderState(
    userId: string,
  ): Promise<PrimaryProviderState | null>;
  /** Links the identity now, and makes it primary when `primaryProvider` is given. */
  abstract addLink(
    account: StoredAccount,
    link: { provider: string; providerId: string; primaryProvider?: string },
  ): Promise<StoredAccount>;
  /** The account as the unit of work sees it, for the write that follows. */
  abstract readAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null>;
  /**
   * Removes every link to the provider and stores the primary provider given,
   * for an account whose ways in the unit of work holds.
   */
  abstract removeLink(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    unlink: { provider: string; primaryProvider: string | undefined },
  ): Promise<StoredAccount>;
  abstract savePrimaryProvider(
    account: StoredAccount,
    provider: string,
  ): Promise<StoredAccount>;

  /** The account a provider profile is synced onto, deactivated or not. */
  abstract findSyncTarget(userId: string): Promise<StoredAccount | null>;
  abstract saveSyncedProfile(
    account: StoredAccount,
    profile: SyncedProfile,
  ): Promise<StoredAccount>;
  abstract findSyncSource(
    userId: string,
  ): Promise<{ primaryProvider?: string } | null>;
  abstract findSyncStatus(userId: string): Promise<SyncStatus | null>;
  abstract findConflictSource(
    userId: string,
  ): Promise<{ primaryProvider?: string } | null>;
  /** How many accounts with a provider profile were not synced since `before`. */
  abstract countDueForSync(
    before: Date,
    primaryProviderNot: string,
    limit: number,
  ): Promise<number>;
}

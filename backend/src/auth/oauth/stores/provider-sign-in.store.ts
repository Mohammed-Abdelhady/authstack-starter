import { StoredAccount } from '../../../user/stores/stored-account';

export interface ProviderIdentity {
  provider: string;
  providerId: string;
}

export interface NewProviderAccount extends ProviderIdentity {
  email: string;
  name: string;
  avatarUrl?: string;
  role: string;
}

/**
 * What signing in through a provider needs of accounts: the account behind a
 * provider identity, or behind its address, and the two writes a first
 * sign-in makes. Every method is one statement that commits by itself. The
 * reads answer with deactivated accounts too: the service refuses those.
 *
 * One provider identity belongs to one account, and one address to one
 * account. A write that would break either rule is refused with a
 * `UniqueConflictError` named by `ACCOUNT_CONSTRAINT`.
 */
export abstract class ProviderSignInStore {
  abstract findByIdentity(
    identity: ProviderIdentity,
  ): Promise<StoredAccount | null>;

  abstract findByAddress(email: string): Promise<StoredAccount | null>;

  /**
   * Links the identity to an account `findByAddress` returned, marks its
   * address verified, and makes the provider primary when it has none.
   */
  abstract linkFirstSignIn(
    account: StoredAccount,
    identity: ProviderIdentity,
  ): Promise<StoredAccount>;

  /** Stores a verified account that signs in through the provider. */
  abstract createFromProvider(
    account: NewProviderAccount,
  ): Promise<StoredAccount>;
}

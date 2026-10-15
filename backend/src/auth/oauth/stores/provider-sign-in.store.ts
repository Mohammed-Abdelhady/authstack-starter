import type { RoleAudience } from '../../../host/types/host-role.type';
import { StoredAccount } from '../../../user/stores/stored-account';
import type { SupportedLocale } from '../../../common/constants/locales';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';

export interface ProviderIdentity {
  provider: string;
  providerId: string;
}

export interface NewProviderAccount extends ProviderIdentity {
  audience: RoleAudience | undefined;
  email: string;
  name: string;
  avatarUrl?: string;
  role: string;
  /** The language of the sign-in request that creates the account. */
  locale: SupportedLocale;
}

/**
 * What signing in through a provider needs of accounts: the account behind a
 * provider identity, or behind its address, and the two writes a first
 * sign-in makes. Creation joins the caller's transaction; linking an existing
 * account commits by itself. Reads include deactivated accounts for refusal.
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
  abstract createFromProviderIn(
    unitOfWork: UnitOfWork,
    account: NewProviderAccount,
  ): Promise<StoredAccount>;
}

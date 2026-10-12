import { StoredAccount } from './stored-account';

/**
 * The grants read for one account. The read does not ask for the
 * deactivation: a caller that must refuse a deactivated account reads the
 * account.
 */
export interface AccountGrants {
  id: string;
  role: string;
  permissions: string[];
}

/** Permissions granted to an account itself, apart from its role. */
export abstract class AccountPermissionStore {
  /** Whether the text could be an account id of this database. */
  abstract isAccountId(id: string): boolean;
  abstract findGrants(userId: string): Promise<AccountGrants | null>;
  abstract findAccount(userId: string): Promise<StoredAccount | null>;
  /** Adds the permission and answers with every permission now granted. */
  abstract grantPermission(
    account: StoredAccount,
    permission: string,
  ): Promise<string[]>;
  /** Removes the permission and answers with every permission still granted. */
  abstract revokePermission(
    account: StoredAccount,
    permission: string,
  ): Promise<string[]>;
}

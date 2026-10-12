import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { StoredAccount } from './stored-account';

/** What the password check reads. The hash never leaves with a profile. */
export interface AccountPassword {
  id: string;
  isDeleted: boolean;
  passwordHash?: string;
}

/** `role_missing` when no admin role is stored to hold the fence. */
export type AdminFence = 'fenced' | 'role_missing';

/**
 * What a person's own profile needs: reading it, renaming it, changing the
 * password and leaving.
 *
 * The three methods that take a unit of work belong to one atomic change with
 * the sign-out that follows it. Once `fenceAdminRole` has returned, no other
 * unit of work can pass the same fence until this one ends: a second one that
 * reaches it is refused at once with a retryable abort, runs again, and counts
 * the admins that are left then. A count is only good behind the fence, so an
 * adapter may take the fence already at `countOtherActiveAdmins`.
 */
export abstract class AccountProfileStore {
  /** Whether the text could be an account id of this database. */
  abstract isAccountId(id: string): boolean;

  /** The profile without the password hash. */
  abstract findProfile(userId: string): Promise<StoredAccount | null>;
  abstract findAccount(userId: string): Promise<StoredAccount | null>;
  /** Stores the account again, with the new name when one is given. */
  abstract saveProfile(
    account: StoredAccount,
    changes: { name?: string },
  ): Promise<StoredAccount>;
  abstract findPassword(userId: string): Promise<AccountPassword | null>;
  abstract findPrimaryProvider(userId: string): Promise<string | undefined>;
  /**
   * What `RolePermissions.ofRole` answers for the slug. An adapter asks that
   * port's adapter and keeps no query of its own.
   */
  abstract findRolePermissions(slug: string): Promise<string[] | null>;
  abstract countPasskeys(userId: string): Promise<number>; // feature:passkeys

  abstract readAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null>;
  abstract savePasswordHash(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    passwordHash: string,
  ): Promise<void>;
  abstract saveDeactivation(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    deletedAt: Date,
  ): Promise<void>;
  /** Admins that are not deactivated, leaving this account out. */
  abstract countOtherActiveAdmins(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<number>;
  abstract fenceAdminRole(unitOfWork: UnitOfWork): Promise<AdminFence>;
}

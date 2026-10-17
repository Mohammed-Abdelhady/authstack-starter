import type { RoleAudience } from '../../host/types/host-role.type';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { StoredAccount } from '../../user/stores/stored-account';
import type { SupportedLocale } from '../../common/constants/locales';

export interface AdminAccountQuery {
  audiences?: readonly RoleAudience[];
  /** Matched against name and address, ignoring case, taken literally. */
  search?: string;
  role?: string;
  status?: 'active' | 'inactive' | 'deleted';
  isVerified?: boolean;
  /** Role slugs the actor may see. Nothing outside them is listed. */
  viewableRoles: string[];
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export interface AdminAccountPage {
  accounts: StoredAccount[];
  total: number;
}

export interface NewAdminAccount {
  audience?: RoleAudience;
  email: string;
  name: string;
  /** Absent for an account made from an invitation, which signs in without one. */
  passwordHash?: string;
  role: string;
  locale: SupportedLocale;
}

/** A role as an assignment refers to it. */
export interface AssignableRole {
  audience?: RoleAudience;
  id: string;
  slug: string;
}

/** An account exactly as its creation left it, so only that one is removed. */
export interface CreatedAccountMark {
  id: string;
  role: string;
  updatedAt: Date;
  sessionVersion: number;
}

/** The pending address a code is allowed to confirm. */
export interface PendingAddress {
  email: string | null;
  addressGeneration: number;
}

export interface AccountIdentityEdit {
  name?: string;
  address?: PendingAddress;
}

/**
 * Accounts as the admin area reads and changes them.
 *
 * The methods without a unit of work read what is committed and are used to
 * refuse early. Every change is made by a method that takes one: the actor and
 * the target are read again inside it, so a check made before it started is
 * never what a write relies on.
 *
 * The target is read with `takeAccountForChange`. From then on no other unit
 * of work can change that account until this one ends: a second one is refused
 * at once with a retryable abort, at this read or at its own write, and runs
 * again. The actor is read with `readAccount` and is not taken.
 */
export abstract class AdminAccountStore {
  abstract lastActiveFor(
    userIds: readonly string[],
    unitOfWork?: UnitOfWork,
  ): Promise<Map<string, Date | null>>;
  abstract findAccount(userId: string): Promise<StoredAccount | null>;
  /** The account without its secrets, for answering a read. */
  abstract findAccountView(userId: string): Promise<StoredAccount | null>;
  abstract listAccounts(query: AdminAccountQuery): Promise<AdminAccountPage>;
  /** True when any account, deactivated or not, has the address. */
  abstract isAddressTaken(email: string): Promise<boolean>;
  abstract findRole(roleId: string): Promise<AssignableRole | null>;
  abstract findRoleBySlug(slug: string): Promise<AssignableRole | null>;

  abstract readAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null>;
  abstract takeEmailChangeTarget(
    uow: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null>;

  abstract takeAccountForChange(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<StoredAccount | null>;
  abstract readRoleBySlug(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<AssignableRole | null>;
  /** Deactivates the account at `deletedAt`, or brings it back when it is absent. */
  abstract saveActivation(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    deletedAt: Date | undefined,
  ): Promise<StoredAccount>;
  abstract saveRole(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    slug: string,
  ): Promise<StoredAccount>;
  /** A taken address is refused with a unique conflict named for the address. */
  abstract saveIdentity(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    edit: AccountIdentityEdit,
  ): Promise<StoredAccount>;
  /** Replace the direct permission list inside the account's unit of work. */
  abstract savePermissions(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    permissions: string[],
  ): Promise<StoredAccount>;
  /** A taken address is refused with a unique conflict named for the address. */
  abstract insertAccount(
    unitOfWork: UnitOfWork,
    account: NewAdminAccount,
  ): Promise<StoredAccount>;
  /** Removes the account only while it is still as its creation left it. */
  abstract removeCreatedAccount(
    unitOfWork: UnitOfWork,
    created: CreatedAccountMark,
  ): Promise<void>;
}

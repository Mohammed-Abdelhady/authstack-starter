import { AdminAccountStore } from '../../../../src/admin/stores/admin-account.store';
import {
  ActivationAccounts,
  ActivationSignIn,
} from '../../../../src/auth/pending-codes/activation-accounts';
import { MailCounterStore } from '../../../../src/auth/pending-codes/mail-counter.store';
import { PasswordSignInStore } from '../../../../src/auth/stores/password-sign-in.store';
import { PendingRegistrationStore } from '../../../../src/auth/pending-codes/pending-registration.store';
import { IdFormat } from '../../../../src/common/persistence/id-format';
import {
  RerunPause,
  UnitOfWorkRunner,
} from '../../../../src/common/persistence/unit-of-work';
import { RoleCatalogStore } from '../../../../src/role/stores/role-catalog.store';
import { RoleChangeStore } from '../../../../src/role/stores/role-change.store';
import { RolePermissions } from '../../../../src/role/stores/role-permissions';
import { RoleSweepStore } from '../../../../src/role/stores/role-sweep.store';
import { AccountPermissionStore } from '../../../../src/user/stores/account-permission.store';
import { AccountProfileStore } from '../../../../src/user/stores/account-profile.store';
import { AccountSessions } from '../../../../src/user/stores/account-sessions';
import { FrozenClock } from '../../frozen-clock';

export interface SeedRole {
  name: string;
  slug: string;
  level?: number;
  permissions: string[];
}

export interface SeedAccount {
  email: string;
  pendingEmail?: string;
  name?: string;
  role: string;
  permissions?: string[];
  passwordHash?: string;
  verified?: boolean;
  deleted?: boolean;
  addressGeneration?: number;
  /** When the account was created, for the order of a listing. */
  createdAt?: Date;
}

export interface StoredAccountFacts {
  email: string;
  pendingEmail: string | null;
  name: string;
  role: string;
  permissions: string[];
  passwordHash: string | null;
  isVerified: boolean;
  isDeleted: boolean;
  deletedAt: Date | null;
  sessionVersion: number;
  addressGeneration: number;
  authProvider: string | null;
  primaryProvider: string | null;
}

export interface StoredAccountEvent {
  targetUserId: string | null;
  actorId: string | null;
  sessionId: string | null;
  action: string;
  reasonCode: string | null;
  assignedRoleId: string | null;
  previousRoleId: string | null;
  assignmentSessionVersion: number | null;
}

/**
 * What one database gives the shared account cases: the adapters under test,
 * its runner, and plain reads and writes of stored state that go around the
 * adapters so a case can check what was really stored.
 */
export interface AccountsContractHarness {
  readonly clock: FrozenClock;
  readonly profiles: AccountProfileStore;
  readonly permissions: AccountPermissionStore;
  readonly sessions: AccountSessions;
  readonly admin: AdminAccountStore;
  readonly activation: ActivationAccounts;
  readonly signIn: ActivationSignIn;
  readonly roleCatalog: RoleCatalogStore;
  readonly roleChanges: RoleChangeStore;
  readonly roleSweeps: RoleSweepStore;
  readonly registrations: PendingRegistrationStore;
  readonly mailCounters: MailCounterStore;
  readonly passwords: PasswordSignInStore;
  readonly rolePermissions: RolePermissions;
  /** What this database takes as an id, as a route asks it. */
  readonly ids: IdFormat;
  /** The adapter's runner, pausing before a rerun the way the case says. */
  runner(pause: RerunPause): UnitOfWorkRunner;

  seedRole(role: SeedRole): Promise<string>;
  seedAccount(account: SeedAccount): Promise<string>;
  /** A session that is live at the account's current version. */
  seedSession(userId: string): Promise<string>;
  /** Changes stored fields of an account, committed, around the adapters. */
  alterAccount(
    userId: string,
    change: {
      role?: string;
      deleted?: boolean;
      email?: string;
      verified?: boolean;
      permissions?: string[];
    },
  ): Promise<void>;
  removeRole(slug: string): Promise<void>;

  account(userId: string): Promise<StoredAccountFacts | null>;
  accountIdByEmail(email: string): Promise<string | null>;
  /** Sessions that are valid, not revoked and at the account's version. */
  liveSessionIds(userId: string): Promise<string[]>;
  /** Events the cases caused. The row `refuseSecurityEvents` plants is left out. */
  events(): Promise<StoredAccountEvent[]>;
  pendingRegistrations(email: string): Promise<number>;

  /** A well-formed id that names nothing. */
  absentId(): string;
  /** Well-formed for another database and malformed for this one. */
  foreignId(): string;

  /** Until restored, the database refuses every security event as a duplicate. */
  refuseSecurityEvents(): Promise<() => void>;

  reset(): Promise<void>;
  close(): Promise<void>;
}

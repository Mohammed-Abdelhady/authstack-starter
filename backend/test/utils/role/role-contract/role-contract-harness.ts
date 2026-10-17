import type { RoleAudience } from '../../../../src/host/types/host-role.type';
import {
  RerunPause,
  UnitOfWorkRunner,
} from '../../../../src/common/persistence/unit-of-work';
import { RoleCatalogStore } from '../../../../src/role/stores/role-catalog.store';
import { RoleChangeStore } from '../../../../src/role/stores/role-change.store';
import { RoleSweepStore } from '../../../../src/role/stores/role-sweep.store';
import { FrozenClock } from '../../frozen-clock';

export interface SeedRole {
  audience?: RoleAudience;
  name: string;
  slug: string;
  permissions: string[];
  level?: number;
  isSystemRole?: boolean;
  isProtected?: boolean;
  /** When the role was created and last updated. */
  createdAt?: Date;
}

export interface SeedAccount {
  audience?: RoleAudience;
  role: string;
  permissions?: string[];
  deleted?: boolean;
}

export interface InterruptedRename {
  name: string;
  slug: string;
  previousSlug: string;
  actorId: string;
}

export interface OwedRepair {
  roleId: string;
  previousSlug: string;
  actorId: string;
  sweepId?: string;
}

export interface SeedAssignment {
  userId: string;
  assignedRoleId: string;
  previousRoleId?: string;
  sessionVersion: number;
}

export interface StoredRoleFacts {
  audience?: RoleAudience;
  id: string;
  name: string;
  slug: string;
  description: string | null;
  level: number | null;
  permissions: string[];
  isSystemRole: boolean;
  isProtected: boolean;
  owedRepairs: string[];
}

export interface StoredAccountFacts {
  audience?: RoleAudience;
  role: string;
  sessionVersion: number;
}

export interface StoredRevocation {
  targetUserId: string | null;
  actorId: string | null;
  action: string;
  reasonCode: string | null;
}

/**
 * What one database gives the shared role cases: the three adapters under
 * test, its runner, and plain reads and writes of stored state that go around
 * the adapters so a case can check what was really stored.
 */
export interface RoleContractHarness {
  readonly clock: FrozenClock;
  readonly catalog: RoleCatalogStore;
  readonly changes: RoleChangeStore;
  readonly sweeps: RoleSweepStore;
  /** The adapter's runner, pausing before a rerun the way the case says. */
  runner(pause: RerunPause): UnitOfWorkRunner;

  seedRole(role: SeedRole): Promise<string>;
  alterRoleAudience(slug: string, audience: RoleAudience): Promise<void>;
  seedAccount(account: SeedAccount): Promise<string>;
  /** Stores `count` accounts on a role in bulk. Answers with their ids, sorted. */
  seedAccounts(count: number, role: string): Promise<string[]>;
  /**
   * Leaves a role the way a rename interrupted after its commit would: renamed,
   * with the repair recorded as owed, while nothing has moved its holders.
   */
  interruptRename(roleId: string, rename: InterruptedRename): Promise<void>;

  /** Records a repair as owed by a role without touching when it was updated. */
  oweRepair(ownerRoleId: string, repair: OwedRepair): Promise<void>;
  /** The history an admin assignment leaves: which role the account held before. */
  seedAssignment(assignment: SeedAssignment): Promise<void>;

  role(slug: string): Promise<StoredRoleFacts | null>;
  account(userId: string): Promise<StoredAccountFacts | null>;
  /** Events the cases caused. The row `refuseSecurityEvents` plants is left out. */
  events(): Promise<StoredRevocation[]>;

  /** A well-formed id that names nothing. */
  absentId(): string;
  /** Well-formed for another database and malformed for this one. */
  foreignId(): string;

  /** Until restored, the database refuses every security event as a duplicate. */
  refuseSecurityEvents(): Promise<() => void>;

  reset(): Promise<void>;
  close(): Promise<void>;
}

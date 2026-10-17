import type { RoleAudience } from '../../host/types/host-role.type';
import { UnitOfWork } from '../../common/persistence/unit-of-work';

export interface SeedRole {
  audience?: RoleAudience;
  name: string;
  slug: string;
  description: string;
  isSystemRole: boolean;
  isProtected: boolean;
  level: number;
  /**
   * A stored level above `level` stays. Set for admin, so a reseed with fewer
   * or lower host roles never puts admin under a role still stored.
   */
  levelNeverLowers: boolean;
  permissions: string[];
}

export const ROLE_SEED = {
  CREATED: 'created',
  REFRESHED: 'refreshed',
} as const;

export type RoleSeedOutcome = (typeof ROLE_SEED)[keyof typeof ROLE_SEED];

export interface NewSeedAccount {
  audience?: RoleAudience;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  passwordHash: string;
}

const RESET_ENVIRONMENTS: readonly string[] = ['development', 'test'];

/**
 * Refuses to empty a database outside development and test. The service asks
 * first, and every adapter asks again right before the statement that removes
 * the rows, so no caller of the store can skip the question.
 */
export function assertResetAllowed(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (nodeEnv === undefined || !RESET_ENVIRONMENTS.includes(nodeEnv)) {
    throw new Error(
      'Database reset is only allowed when NODE_ENV is "development" or "test".',
    );
  }
}

/**
 * Seed account inserts join the caller's UOW. Other seed operations commit
 * independently so an interrupted bootstrap can be resumed.
 */
export abstract class SeedStore {
  /**
   * Stores the role when no role carries its slug. A role that does keeps its
   * name, description and permissions, and takes the seed's flags and level.
   * With `levelNeverLowers` it takes the higher of the stored and seed level,
   * in the same statement.
   */
  abstract seedRole(role: SeedRole): Promise<RoleSeedOutcome>;

  /** Replaces what the role with this slug grants. Nothing for no such role. */
  abstract replaceRolePermissions(
    slug: string,
    permissions: string[],
  ): Promise<void>;

  /** The id of the account with this address, deactivated or not. */
  abstract findAccountId(email: string): Promise<string | null>;

  abstract roleAudience(
    uow: UnitOfWork,
    slug: string,
  ): Promise<RoleAudience | undefined>;

  /** Stores a verified account that signs in with a password. Answers its id. */
  abstract createAccount(
    uow: UnitOfWork,
    account: NewSeedAccount,
  ): Promise<string>;

  /**
   * Removes everything the application stores and keeps the record of which
   * migrations were applied. Refuses outside development and test, with
   * `assertResetAllowed`, before it removes anything.
   */
  abstract clearApplicationData(): Promise<void>;
}

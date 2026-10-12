export interface SeedRole {
  name: string;
  slug: string;
  description: string;
  isSystemRole: boolean;
  isProtected: boolean;
  level: number;
  permissions: string[];
}

export const ROLE_SEED = {
  CREATED: 'created',
  REFRESHED: 'refreshed',
} as const;

export type RoleSeedOutcome = (typeof ROLE_SEED)[keyof typeof ROLE_SEED];

export interface NewSeedAccount {
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
 * What seeding and resetting a development database needs stored. Each method
 * is one statement that commits by itself: a seed that stops half way is run
 * again, and running it again changes nothing that is already there.
 */
export abstract class SeedStore {
  /**
   * Stores the role when no role carries its slug. A role that does keeps its
   * name, description and permissions, and takes the seed's level and flags.
   */
  abstract seedRole(role: SeedRole): Promise<RoleSeedOutcome>;

  /** Replaces what the role with this slug grants. Nothing for no such role. */
  abstract replaceRolePermissions(
    slug: string,
    permissions: string[],
  ): Promise<void>;

  /** The id of the account with this address, deactivated or not. */
  abstract findAccountId(email: string): Promise<string | null>;

  /** Stores a verified account that signs in with a password. Answers its id. */
  abstract createAccount(account: NewSeedAccount): Promise<string>;

  /**
   * Removes everything the application stores and keeps the record of which
   * migrations were applied. Refuses outside development and test, with
   * `assertResetAllowed`, before it removes anything.
   */
  abstract clearApplicationData(): Promise<void>;
}

import type { RoleAudience } from '../../../src/host/types/host-role.type';
import { AddressLedger } from '../../../src/common/persistence/address-ledger';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { SeedStore } from '../../../src/database/seeds/seed.store';
import { ApplicationRegistry } from '../../../src/session/applications/application-registry';
import { FrozenClock } from '../frozen-clock';

export interface StoredSeedRole {
  audience?: RoleAudience;
  name: string;
  slug: string;
  description: string | null;
  isSystemRole: boolean;
  isProtected: boolean;
  level: number | null;
  permissions: string[];
}

export interface StoredSeedAccount {
  audience?: RoleAudience;
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  passwordHash: string | null;
  isVerified: boolean;
  isDeleted: boolean;
  authProvider: string | null;
}

export interface StoredSeedApplication {
  clientId: string;
  platform: string;
  enabled: boolean;
}

/**
 * What one database gives the shared seed cases: the adapter under test, the
 * real application registry on the same database, and plain reads and writes
 * of stored state that go around both.
 */
export interface SeedContractHarness {
  readonly clock: FrozenClock;
  readonly ledger: AddressLedger;
  readonly runner: UnitOfWorkRunner;
  readonly seeds: SeedStore;
  readonly registry: ApplicationRegistry;
  /** Every stored application, by client id. */
  storedApplications(): Promise<StoredSeedApplication[]>;
  /** Every stored role, by slug. */
  storedRoles(): Promise<StoredSeedRole[]>;
  /** Every stored account, by address. */
  storedAccounts(): Promise<StoredSeedAccount[]>;
  plantRole(role: StoredSeedRole): Promise<void>;
  plantAccount(account: {
    audience?: RoleAudience;
    email: string;
    name: string;
    role: string;
    passwordHash: string;
  }): Promise<string>;
  /** Records one applied migration, where the database has no record of its own yet. */
  plantMigrationRecord(name: string): Promise<void>;
  /** The names of the migrations recorded as applied, in order. */
  migrationRecord(): Promise<string[]>;
  /** Empties everything a case stored. The migration record stays. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

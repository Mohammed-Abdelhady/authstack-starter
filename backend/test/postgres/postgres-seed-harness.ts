import { ConfigService } from '@nestjs/config';
import { PostgresAddressLedger } from '../../src/common/persistence/postgres/postgres-address-ledger';
import { AuthEpochService } from '../../src/common/services/auth-epoch.service';
import { ApplicationRegistry } from '../../src/session/applications/application-registry';
import { SeedContractHarness } from '../utils/database/seed-contract-harness';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import { PostgresApplicationRegistryStore } from '../../src/session/persistence/postgres/postgres-application-registry.store';
import { PostgresSeedStore } from '../../src/database/seeds/persistence/postgres/postgres-seed.store';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { openTestConnection } from './postgres-connection';

export async function bootPostgresSeedHarness(): Promise<SeedContractHarness> {
  const connection = await openTestConnection();
  const { database, pool } = connection;
  const clock = new FrozenClock(TEST_NOW);

  return {
    clock,
    ledger: new PostgresAddressLedger(),
    runner: new PostgresUnitOfWorkRunner(database),
    seeds: new PostgresSeedStore(database, clock),
    registry: new ApplicationRegistry(
      new PostgresUnitOfWorkRunner(database),
      new PostgresApplicationRegistryStore(database),
      new AuthEpochService(
        new ConfigService({
          auth: { epoch: 1, nativeEnabled: false },
          server: { nodeEnv: 'test' },
          cors: { clientUrl: 'http://localhost:3000' },
        }),
      ),
    ),

    storedApplications: async () => {
      const rows = await database
        .selectFrom('applications')
        .select(['client_id', 'platform', 'enabled'])
        .orderBy('client_id', 'asc')
        .execute();
      return rows.map((row) => ({
        clientId: row.client_id,
        platform: row.platform,
        enabled: row.enabled,
      }));
    },
    storedRoles: async () => {
      const rows = await database
        .selectFrom('roles')
        .selectAll()
        .orderBy('slug', 'asc')
        .execute();
      return rows.map((row) => ({
        name: row.name,
        slug: row.slug,
        description: row.description,
        isSystemRole: row.is_system_role,
        isProtected: row.is_protected,
        level: row.level,
        permissions: row.permissions,
      }));
    },
    storedAccounts: async () => {
      const rows = await database
        .selectFrom('users')
        .selectAll()
        .orderBy('email', 'asc')
        .execute();
      return rows.map((row) => ({
        id: row.id,
        email: row.email ?? '',
        name: row.name ?? '',
        role: row.role,
        permissions: row.permissions,
        passwordHash: row.password_hash,
        isVerified: row.is_verified,
        isDeleted: row.is_deleted,
        authProvider: row.auth_provider,
      }));
    },
    plantRole: async (role) => {
      await database
        .insertInto('roles')
        .values({
          name: role.name,
          slug: role.slug,
          description: role.description,
          is_system_role: role.isSystemRole,
          is_protected: role.isProtected,
          level: role.level,
          permissions: role.permissions,
          created_at: clock.now(),
          updated_at: clock.now(),
        })
        .execute();
    },
    plantAccount: async (account) => {
      const row = await database
        .insertInto('users')
        .values({
          email: account.email,
          name: account.name,
          role: account.role,
          password_hash: account.passwordHash,
          is_verified: true,
          auth_provider: 'email',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    // The adapter recorded every migration it applied when the harness booted.
    plantMigrationRecord: () => Promise.resolve(),
    migrationRecord: async () => {
      const applied = await pool.query<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name',
      );
      return applied.rows.map(({ name }) => name);
    },
    reset: connection.reset,
    close: connection.close,
  };
}

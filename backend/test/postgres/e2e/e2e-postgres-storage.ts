import type { INestApplication } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import type { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { commitCheckedPool } from '../../../src/common/persistence/postgres/postgres-commit-tag';
import {
  openPostgresPool,
  POSTGRES_DATABASE,
  POSTGRES_POOL,
  type PostgresDatabase,
} from '../../../src/common/persistence/postgres/postgres-connection';
import { openPostgresDatabase } from '../../../src/common/persistence/postgres/postgres-database';
import { sqlStateOf } from '../../../src/common/utils/sql-state.util';
import { POSTGRES_HEALTH_POOL } from '../../../src/health/persistence/postgres/postgres-health-persistence';
import { ApplicationRegistry } from '../../../src/session/applications/application-registry';
import type { AttachedE2eStorage, E2eStorage } from '../../utils/e2e-storage';
import { postgresAuthState } from '../e2e-postgres-state-auth';
import { postgresRecordsState } from '../e2e-postgres-state-records';
import {
  postgresAccountsState,
  postgresApplicationsState,
  postgresSessionsState,
} from '../e2e-postgres-state-shared';
import { CommitFaultDialect } from '../postgres-commit-faults';
import { emptyEveryTable } from '../postgres-connection';
import { postgresNativeState } from '../e2e-postgres-state-native';
import { noteSessionsLeftOpen } from './postgres-fixture-connections';
import {
  connectionUrl,
  E2E_TEMPLATE_DATABASE,
  onServer,
  quotedName,
  sharedPostgresServer,
} from './postgres-e2e-server';

/** The server refuses to drop a database a session is still connected to. */
const DATABASE_IN_USE = '55006';

/**
 * Drops the fixture's database. Its pools were ended first, so no session
 * should be on it, and the server waits five seconds for the last ones to go
 * before it refuses. A session that is still there was left open by something:
 * it is counted for the connection watch, and only then ended by force.
 */
async function dropFixtureDatabase(
  client: Client,
  name: string,
): Promise<void> {
  try {
    await client.query(`DROP DATABASE IF EXISTS ${quotedName(name)}`);
  } catch (error) {
    if (sqlStateOf(error) !== DATABASE_IN_USE) {
      throw error;
    }
    const open = await client.query<{ sessions: number }>(
      'SELECT count(*)::int AS sessions FROM pg_stat_activity WHERE datname = $1',
      [name],
    );
    noteSessionsLeftOpen(open.rows[0].sessions);
    await client.query(
      `DROP DATABASE IF EXISTS ${quotedName(name)} WITH (FORCE)`,
    );
  }
}

/**
 * A database of its own on the run's shared server, copied from the migrated
 * template and dropped when the fixture closes.
 */
export async function startPostgresE2eStorage(): Promise<E2eStorage> {
  const server = sharedPostgresServer();
  const name = `auth_e2e_${randomUUID().replaceAll('-', '')}`;
  await onServer(server, (client) =>
    client.query(
      `CREATE DATABASE ${quotedName(name)} TEMPLATE ${quotedName(E2E_TEMPLATE_DATABASE)}`,
    ),
  );

  let pool: Pool | undefined;
  let healthPool: Pool | undefined;
  let database: PostgresDatabase | undefined;
  let commitFaults: CommitFaultDialect | undefined;

  return {
    environment: {
      DATABASE_TYPE: 'postgres', // feature:database-choice
      POSTGRES_URL: connectionUrl(server, name),
    },
    prepare: (builder: TestingModuleBuilder): Promise<void> => {
      // The fixture owns the pool on its own database: a second application
      // booted in one suite must not reach the database of the first through
      // settings read at first load.
      pool = openPostgresPool({ ...server, database: name });
      builder.overrideProvider(POSTGRES_POOL).useValue(pool);
      // The same database the server builds on that pool, with the one seam
      // a case needs to lose the answer to a commit.
      commitFaults = new CommitFaultDialect({ pool: commitCheckedPool(pool) });
      database = openPostgresDatabase(pool, commitFaults);
      builder.overrideProvider(POSTGRES_DATABASE).useValue(database);
      healthPool = openPostgresPool({ ...server, database: name, max: 1 });
      builder.overrideProvider(POSTGRES_HEALTH_POOL).useValue(healthPool);
      return Promise.resolve();
    },
    attach: (app: INestApplication): Promise<AttachedE2eStorage> => {
      if (!database || !commitFaults) {
        throw new Error('The fixture was attached before it was prepared');
      }
      const stored = database;
      const applications = app.get(ApplicationRegistry, { strict: false });
      const accounts = postgresAccountsState(stored);
      return Promise.resolve({
        state: {
          accounts,
          sessions: postgresSessionsState(stored),
          applications: postgresApplicationsState(stored),
          auth: postgresAuthState(app, stored, commitFaults),
          native: postgresNativeState(app, stored),
          records: postgresRecordsState(stored),
        },
        empty: () => emptyEveryTable(stored),
        seedApplications: async () => {
          await applications.seedFirstPartyApplications();
          await applications.ensureClientOriginAllowed();
        },
        seedAccounts: (seeded) => accounts.seedAccounts(seeded),
      });
    },
    stop: async () => {
      for (const owned of [pool, healthPool]) {
        if (owned && !owned.ended) {
          await owned.end();
        }
      }
      await onServer(server, (client) => dropFixtureDatabase(client, name));
    },
  };
}

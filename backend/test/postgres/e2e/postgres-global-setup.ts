import { Pool } from 'pg';
import { applyPostgresMigrations } from '../../../src/common/persistence/postgres/postgres-migrations';
import {
  PostgresTestServer,
  startPostgresTestServer,
} from '../server/postgres-test-server';
import {
  BACKEND_TEST_POSTGRES_ENV,
  E2E_TEMPLATE_DATABASE,
  onServer,
  quotedName,
} from './postgres-e2e-server';

type ProcessWithPostgresRun = typeof process & {
  __backendTestPostgresRun?: PostgresTestServer;
};

function runProcess(): ProcessWithPostgresRun {
  return process;
}

/** The server the setup started, handed to the teardown once. */
export function takeSharedPostgresRun(): PostgresTestServer | undefined {
  const current = runProcess();
  const server = current.__backendTestPostgresRun;
  delete current.__backendTestPostgresRun;
  return server;
}

/**
 * One server for the whole run, with its own data folder that the launcher
 * removes when the run ends or dies. The migrations are applied once, to a
 * template every fixture copies its own database from.
 */
export default async function postgresGlobalSetup(): Promise<void> {
  if (runProcess().__backendTestPostgresRun) {
    throw new Error('The shared Jest PostgreSQL run is already set up');
  }
  const server = await startPostgresTestServer();
  try {
    await onServer(server.connection, (client) =>
      client.query(`CREATE DATABASE ${quotedName(E2E_TEMPLATE_DATABASE)}`),
    );
    const pool = new Pool({
      ...server.connection,
      database: E2E_TEMPLATE_DATABASE,
    });
    try {
      await applyPostgresMigrations(pool);
    } finally {
      await pool.end();
    }
  } catch (error) {
    await server.stop();
    throw error;
  }
  runProcess().__backendTestPostgresRun = server;
  process.env[BACKEND_TEST_POSTGRES_ENV] = JSON.stringify(server.connection);
  console.info(
    `[jest-postgres] started port=${server.connection.port} data=${server.dataDirectory}`,
  );
}

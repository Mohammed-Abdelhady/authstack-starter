import { BACKEND_TEST_POSTGRES_ENV } from './postgres-e2e-server';
import { takeSharedPostgresRun } from './postgres-global-setup';

export default async function postgresGlobalTeardown(): Promise<void> {
  const server = takeSharedPostgresRun();
  if (!server) return;
  try {
    await server.stop();
    console.info(`[jest-postgres] stopped port=${server.connection.port}`);
  } finally {
    delete process.env[BACKEND_TEST_POSTGRES_ENV];
  }
}

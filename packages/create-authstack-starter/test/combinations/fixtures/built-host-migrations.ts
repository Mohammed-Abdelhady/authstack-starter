import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { PostgresTestServer } from '../../../../../backend/test/postgres/server/postgres-test-server';

interface FixturePool {
  query<Row>(statement: string): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
}

interface PostgresModules {
  Pool: new (connection: PostgresTestServer['connection']) => FixturePool;
}

interface ServerModule {
  startPostgresTestServer(): Promise<PostgresTestServer>;
}

const project = process.argv[2];
if (!project) throw new Error('The generated project directory is required.');
const backend = join(resolve(project), 'backend');
const requireProject = createRequire(join(backend, 'package.json'));
// Load the generated project's TypeScript server helper under its own configuration.
process.env.TS_NODE_PROJECT = join(backend, 'tsconfig.json');
requireProject('ts-node/register');
const { Pool } = requireProject('pg') as PostgresModules;
const { startPostgresTestServer } = requireProject(
  './test/postgres/server/postgres-test-server',
) as ServerModule;
const MIGRATE_CLI = join(backend, 'dist/common/persistence/postgres/postgres-migrate.cli.js');
const CLI_TIMEOUT_MS = 120_000;

async function main(): Promise<void> {
  const server = await startPostgresTestServer();
  const pool = new Pool(server.connection);
  try {
    // Source suites run next without this fixture; only dist can supply the file here.
    rmSync(join(backend, 'src/host/migrations/0042_orders.sql'));
    const { port, password } = server.connection;
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      POSTGRES_POOL_MAX: '10',
      POSTGRES_URL: `postgres://postgres:${password}@127.0.0.1:${port}/postgres`,
      OAUTH_STATE_SECRET: 'packed-host-migration-test-secret-32-chars',
      PASSKEYS_ENABLED: 'false',
      TWO_FACTOR_ENABLED: 'false',
      MAGIC_LINK_ENABLED: 'false',
    };
    const usage = spawnSync(process.execPath, [MIGRATE_CLI, 'adopt-host'], {
      cwd: backend,
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: CLI_TIMEOUT_MS,
    });
    const cli = (command: string) => {
      const result = spawnSync(process.execPath, [MIGRATE_CLI, command], {
        cwd: backend,
        env,
        encoding: 'utf8',
        timeout: CLI_TIMEOUT_MS,
      });
      if (result.status !== 0) {
        throw new Error(String(result.error ?? result.stdout + result.stderr));
      }
      return result;
    };
    const up = cli('up');
    const status = cli('status');
    const host = await pool.query<{ name: string }>(
      'SELECT name FROM host_migrations ORDER BY name',
    );
    const orders = await pool.query<{ id: number }>('SELECT id FROM host_orders');
    console.log(
      JSON.stringify({
        up: up.status,
        status: status.status,
        usage: usage.status,
        host: host.rows.map(({ name }) => name),
        orders: orders.rows,
        lines: status.stdout.trim().split('\n'),
      }),
    );
  } finally {
    try {
      await pool.end();
    } finally {
      await server.stop();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { sql } from 'kysely';
import { Pool } from 'pg';
import {
  POSTGRES_HEALTH_POOL,
  POSTGRES_HEALTH_PROVIDERS,
} from '../../../health/persistence/postgres/postgres-health-persistence';
import { PostgresStoreHealthWatch } from '../../../health/persistence/postgres/postgres-store-health-watch';
import { StoreHealth } from '../../../health/store-health';
import { PersistenceUnavailableError } from '../persistence-errors';
import { openPostgresDatabase } from './postgres-database';
import {
  postgresTransactionOf,
  PostgresUnitOfWorkRunner,
} from './postgres-unit-of-work';
import {
  backendPidOf,
  countersOf,
  SLOW_COMMIT_TABLE,
  useSessionLossServer,
} from './session-loss.harness-spec';

const BACKEND = join(__dirname, '..', '..', '..', '..');
const CHILD = join(__dirname, 'session-loss-child.harness-spec.ts');
/** The child compiles the adapter before it runs, which the default bound does not cover. */
const CHILD_CASE_TIMEOUT_MS = 60_000;

interface ChildRun {
  exitCode: number | null;
  said: unknown;
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
} {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('a PostgreSQL session that ends under the application', () => {
  const server = useSessionLossServer();
  const children = new Set<ReturnType<typeof spawn>>();

  afterEach(() => {
    for (const child of children) child.kill();
    children.clear();
  });

  function runChild(url: string): Promise<ChildRun> {
    const child = spawn(
      process.execPath,
      ['-r', require.resolve('ts-node/register/transpile-only'), CHILD, url],
      { cwd: BACKEND, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    children.add(child);
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => {
        const last = output.trim().split('\n').pop() ?? '';
        const said: unknown = last.startsWith('{') ? JSON.parse(last) : null;
        resolve({ exitCode, said });
      });
    });
  }

  function open(max = 1) {
    const pool = server.openPool({ max });
    const database = openPostgresDatabase(pool);
    return { pool, database, runner: new PostgresUnitOfWorkRunner(database) };
  }

  it(
    'leaves the process running when a statement in flight loses its session',
    async () => {
      const run = await runChild(server.url());

      expect(run).toEqual({
        exitCode: 0,
        said: { inFlightWork: 'PersistenceUnavailableError', nextAnswer: 1 },
      });
    },
    CHILD_CASE_TIMEOUT_MS,
  );

  it('refuses the work whose statement was in flight, and serves the next on a new connection', async () => {
    const { pool, runner } = open();
    const pid = deferred<number>();

    const work = runner.run(async (unitOfWork) => {
      const transaction = postgresTransactionOf(unitOfWork);
      pid.resolve(await backendPidOf(transaction));
      await sql`SELECT pg_sleep(60)`.execute(transaction);
    });
    const refused = expect(work).rejects.toBeInstanceOf(
      PersistenceUnavailableError,
    );
    const ended = await pid.promise;
    await server.endSession(ended);
    await refused;
    const next = await runner.run((unitOfWork) =>
      backendPidOf(postgresTransactionOf(unitOfWork)),
    );

    expect({ sameSession: next === ended, pool: countersOf(pool) }).toEqual({
      sameSession: false,
      pool: { total: 1, idle: 1, waiting: 0 },
    });
  });

  it('replaces a connection that lost its session while idle in the pool', async () => {
    const { pool, database } = open();
    const ended = await backendPidOf(database);
    const noticed = server.nextConnectionError();

    await server.endSession(ended);
    await noticed;
    const afterLoss = countersOf(pool);
    const next = await backendPidOf(database);

    expect({
      afterLoss,
      sameSession: next === ended,
      pool: countersOf(pool),
    }).toEqual({
      afterLoss: { total: 0, idle: 0, waiting: 0 },
      sameSession: false,
      pool: { total: 1, idle: 1, waiting: 0 },
    });
  });

  it('refuses the work whose COMMIT was in flight, and stores nothing of it', async () => {
    const { pool, runner } = open();
    const pid = deferred<number>();

    const work = runner.run(async (unitOfWork) => {
      const transaction = postgresTransactionOf(unitOfWork);
      await sql`
        INSERT INTO ${sql.table(SLOW_COMMIT_TABLE)} (note) VALUES ('held')
      `.execute(transaction);
      pid.resolve(await backendPidOf(transaction));
    });
    const refused = expect(work).rejects.toBeInstanceOf(
      PersistenceUnavailableError,
    );
    await server.endSession(await pid.promise);
    await refused;
    const stored = await sql<{ note: string }>`
      SELECT note FROM ${sql.table(SLOW_COMMIT_TABLE)}
    `.execute(openPostgresDatabase(pool));

    expect({ stored: stored.rows, pool: countersOf(pool) }).toEqual({
      stored: [],
      pool: { total: 1, idle: 1, waiting: 0 },
    });
  });

  it('refuses the work the server timed out while it sat idle in its transaction', async () => {
    const { pool, runner } = open();
    const noticed = server.nextConnectionError();

    const work = runner.run(async (unitOfWork) => {
      const transaction = postgresTransactionOf(unitOfWork);
      await sql`SET LOCAL idle_in_transaction_session_timeout = 100`.execute(
        transaction,
      );
      await noticed;
      await sql`SELECT 1`.execute(transaction);
    });
    await expect(work).rejects.toBeInstanceOf(PersistenceUnavailableError);
    const next = await runner.run(() => Promise.resolve('served'));

    expect({ next, pool: countersOf(pool) }).toEqual({
      next: 'served',
      pool: { total: 1, idle: 1, waiting: 0 },
    });
  });

  describe('on the connection the health look has to itself', () => {
    async function bootHealth() {
      const url = server.url();
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            ignoreEnvVars: true,
            load: [() => ({ POSTGRES_URL: url })],
          }),
        ],
        providers: POSTGRES_HEALTH_PROVIDERS,
      }).compile();
      const app = await moduleRef.init();
      return {
        app,
        pool: app.get<Pool>(POSTGRES_HEALTH_POOL),
        watch: app.get(PostgresStoreHealthWatch),
        health: app.get(StoreHealth),
      };
    }

    it('sees the store again after its session ended during a statement', async () => {
      const { app, pool, watch, health } = await bootHealth();
      const holder = await pool.connect();
      const asked = await holder.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const noticed = server.nextConnectionError();
      const inFlight = holder.query('SELECT pg_sleep(60)').then(
        () => 'answered',
        () => 'refused',
      );

      await server.endSession(asked.rows[0].pid);
      const statement = await inFlight;
      await noticed;
      holder.release();
      await watch.runOnce();
      const seen = health.current();
      await app.close();

      expect({ statement, seen }).toEqual({
        statement: 'refused',
        seen: 'ready',
      });
    });

    it('sees the store again after its idle session ended', async () => {
      const { app, pool, watch, health } = await bootHealth();
      await watch.runOnce();
      const asked = await pool.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const noticed = server.nextConnectionError();

      await server.endSession(asked.rows[0].pid);
      await noticed;
      await watch.runOnce();
      const seen = health.current();
      await app.close();

      expect(seen).toBe('ready');
    });
  });
});

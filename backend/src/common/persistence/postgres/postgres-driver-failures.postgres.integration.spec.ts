import { createServer, Server, Socket } from 'node:net';
import { sql } from 'kysely';
import {
  PersistenceTimeoutError,
  RetryableAbortError,
  UniqueConflictError,
} from '../persistence-errors';
import { openPostgresDatabase } from './postgres-database';
import {
  postgresTransactionOf,
  PostgresUnitOfWorkRunner,
} from './postgres-unit-of-work';
import {
  backendPidOf,
  countersOf,
  useSessionLossServer,
} from './session-loss.harness-spec';

/** A host that takes the connection and never says anything. */
async function silentHost(): Promise<{ port: number; close: () => void }> {
  const taken = new Set<Socket>();
  const host: Server = createServer((socket) => taken.add(socket));
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
  const address = host.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the system gave no port');
  }
  return {
    port: address.port,
    close: () => {
      for (const socket of taken) socket.destroy();
      host.close();
    },
  };
}

describe('failures as PostgreSQL and its driver raise them, through a unit of work', () => {
  const server = useSessionLossServer();
  const rerunAtOnce = (): Promise<void> => Promise.resolve();

  function open(overrides = {}) {
    const pool = server.openPool({ max: 1, ...overrides });
    const database = openPostgresDatabase(pool);
    return {
      pool,
      runner: new PostgresUnitOfWorkRunner(database, rerunAtOnce),
    };
  }

  it('names the rule a real unique violation broke', async () => {
    const { runner } = open();

    const refused = await runner
      .run(async (unitOfWork) => {
        const transaction = postgresTransactionOf(unitOfWork);
        await sql`
          CREATE TABLE taken (name text CONSTRAINT taken_name_unique UNIQUE)
        `.execute(transaction);
        await sql`INSERT INTO taken VALUES ('a'), ('a')`.execute(transaction);
      })
      .catch((error: unknown) => error);

    expect({
      conflict: refused instanceof UniqueConflictError,
      constraint:
        refused instanceof UniqueConflictError ? refused.constraint : null,
    }).toEqual({ conflict: true, constraint: 'taken_name_unique' });
  });

  it('runs the work three times on a real serialization failure, then gives up', async () => {
    const { pool, runner } = open();
    let attempts = 0;

    const refused = await runner
      .run(async (unitOfWork) => {
        attempts += 1;
        await sql`
          DO $$ BEGIN RAISE EXCEPTION 'retry' USING ERRCODE = '40001'; END $$
        `.execute(postgresTransactionOf(unitOfWork));
      })
      .catch((error: unknown) => error);

    expect({
      retryable: refused instanceof RetryableAbortError,
      attempts,
      pool: countersOf(pool),
    }).toEqual({
      retryable: true,
      attempts: 3,
      pool: { total: 1, idle: 1, waiting: 0 },
    });
  });

  it('gives up on a statement the server did not answer in time, and drops its session', async () => {
    const { pool, runner } = open({ query_timeout: 200 });
    let first = 0;

    const refused = await runner
      .run(async (unitOfWork) => {
        const transaction = postgresTransactionOf(unitOfWork);
        first = await backendPidOf(transaction);
        await sql`SELECT pg_sleep(60)`.execute(transaction);
      })
      .catch((error: unknown) => error);
    const afterRefusal = countersOf(pool);
    const second = await runner.run((unitOfWork) =>
      backendPidOf(postgresTransactionOf(unitOfWork)),
    );

    expect({
      timedOut: refused instanceof PersistenceTimeoutError,
      afterRefusal,
      sameSession: second === first,
    }).toEqual({
      timedOut: true,
      afterRefusal: { total: 0, idle: 0, waiting: 0 },
      sameSession: false,
    });
  });

  it('gives up on a host that takes the connection and never answers', async () => {
    const host = await silentHost();
    const { pool, runner } = open({
      connectionString: undefined,
      host: '127.0.0.1',
      port: host.port,
      connectionTimeoutMillis: 200,
    });

    const refused = await runner
      .run(() => Promise.resolve('ran'))
      .catch((error: unknown) => error);
    host.close();

    expect({
      timedOut: refused instanceof PersistenceTimeoutError,
      pool: countersOf(pool),
    }).toEqual({
      timedOut: true,
      pool: { total: 0, idle: 0, waiting: 0 },
    });
  });
});

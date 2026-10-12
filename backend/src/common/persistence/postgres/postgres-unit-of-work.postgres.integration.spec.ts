import { sql } from 'kysely';
import { Pool } from 'pg';
import { closedPort } from '../../../../test/postgres/closed-port';
import {
  PersistenceTimeoutError,
  PersistenceUnavailableError,
} from '../persistence-errors';
import { UnitOfWork } from '../unit-of-work';
import { commitCheckedPool } from './postgres-commit-tag';
import { openPostgresDatabase } from './postgres-database';
import {
  postgresTransactionOf,
  PostgresUnitOfWorkRunner,
} from './postgres-unit-of-work';
import {
  backendPidOf,
  backendPidOfConnection,
  SessionSeamDialect,
  countersOf,
  PROBE_TABLE,
  systemError,
  useSessionLossServer,
} from './session-loss.harness-spec';

const ROLLBACK = 'rollback';

/**
 * Makes every connection of the pool refuse to send ROLLBACK, the way the
 * driver gives up on a statement a silent host never answered: the session is
 * alive and its transaction is still open.
 */
function loseRollbacks(pool: Pool): void {
  pool.on('connect', (client) => {
    const send = client.query.bind(client) as (...sent: unknown[]) => unknown;
    Reflect.set(client, 'query', (...sent: unknown[]) =>
      sent[0] === ROLLBACK
        ? Promise.reject(new Error('Query read timeout'))
        : send(...sent),
    );
  });
}

const note = (unitOfWork: UnitOfWork, text: string): Promise<unknown> =>
  sql`
    INSERT INTO ${sql.table(PROBE_TABLE)} (note) VALUES (${text})
  `.execute(postgresTransactionOf(unitOfWork));

const pidOf = (unitOfWork: UnitOfWork): Promise<number> =>
  backendPidOf(postgresTransactionOf(unitOfWork));

describe('the connection of a PostgreSQL unit of work', () => {
  const server = useSessionLossServer();

  const rerunAtOnce = (): Promise<void> => Promise.resolve();

  function open(max = 1) {
    const pool = server.openPool({ max });
    const database = openPostgresDatabase(pool);
    return {
      pool,
      runner: new PostgresUnitOfWorkRunner(database, rerunAtOnce),
    };
  }

  /** Ends the session the work runs on and waits for the driver to learn of it. */
  async function loseSession(unitOfWork: UnitOfWork): Promise<void> {
    const noticed = server.nextConnectionError();
    await server.endSession(await pidOf(unitOfWork));
    await noticed;
  }

  it('hands back nothing broken when BEGIN is refused, and the next work is served', async () => {
    const pool = server.openPool({ max: 1 });
    const dialect = new SessionSeamDialect({ pool: commitCheckedPool(pool) });
    const runner = new PostgresUnitOfWorkRunner(
      openPostgresDatabase(pool, dialect),
    );
    dialect.beforeBegin = async (connection) => {
      const noticed = server.nextConnectionError();
      await server.endSession(await backendPidOfConnection(connection));
      await noticed;
    };

    const refused = await runner
      .run(() => Promise.resolve('ran'))
      .catch((error: unknown) => error);
    const afterRefusal = countersOf(pool);
    dialect.beforeBegin = undefined;
    const next = await runner.run(() => Promise.resolve('served'));

    expect({
      unavailable: refused instanceof PersistenceUnavailableError,
      afterRefusal,
      next,
      pool: countersOf(pool),
    }).toEqual({
      unavailable: true,
      afterRefusal: { total: 0, idle: 0, waiting: 0 },
      next: 'served',
      pool: { total: 1, idle: 1, waiting: 0 },
    });
  });

  it('keeps a healthy connection for the next work when the work throws', async () => {
    const { pool, runner } = open();
    const fault = new Error('the work gave up');
    let first = 0;

    const raised = await runner
      .run(async (unitOfWork) => {
        first = await pidOf(unitOfWork);
        await note(unitOfWork, 'given up');
        throw fault;
      })
      .catch((error: unknown) => error);
    const afterThrow = countersOf(pool);
    const second = await runner.run(pidOf);

    expect({
      raisedAsThrown: raised === fault,
      afterThrow,
      sameSession: second === first,
      stored: await server.probeNotes(),
    }).toEqual({
      raisedAsThrown: true,
      afterThrow: { total: 1, idle: 1, waiting: 0 },
      sameSession: true,
      stored: [],
    });
  });

  it('gives the slot back when the work throws on a session that is gone', async () => {
    const { pool, runner } = open();
    const fault = new Error('the work gave up');

    const raised = await runner
      .run(async (unitOfWork) => {
        await loseSession(unitOfWork);
        throw fault;
      })
      .catch((error: unknown) => error);
    const afterThrow = countersOf(pool);
    const next = await runner.run(() => Promise.resolve('served'));

    expect({
      raisedAsThrown: raised === fault,
      afterThrow,
      next,
      pool: countersOf(pool),
    }).toEqual({
      raisedAsThrown: true,
      afterThrow: { total: 0, idle: 0, waiting: 0 },
      next: 'served',
      pool: { total: 1, idle: 1, waiting: 0 },
    });
  });

  it('never reuses a session whose ROLLBACK went unanswered', async () => {
    const { pool, runner } = open();
    loseRollbacks(pool);
    let first = 0;

    await runner
      .run(async (unitOfWork) => {
        first = await pidOf(unitOfWork);
        await note(unitOfWork, 'left open');
        throw new Error('the work gave up');
      })
      .catch(() => undefined);
    const afterThrow = countersOf(pool);
    const second = await runner.run(pidOf);

    expect({
      afterThrow,
      sameSession: second === first,
      stored: await server.probeNotes(),
    }).toEqual({
      afterThrow: { total: 0, idle: 0, waiting: 0 },
      sameSession: false,
      stored: [],
    });
  });

  it('asks what became of a COMMIT sent on a session that is gone, and runs the work again', async () => {
    const { pool, runner } = open();
    let attempts = 0;

    const result = await runner.run(async (unitOfWork) => {
      attempts += 1;
      await note(unitOfWork, `attempt ${attempts}`);
      if (attempts === 1) {
        await loseSession(unitOfWork);
      }
      return attempts;
    });

    expect({
      result,
      stored: await server.probeNotes(),
      pool: countersOf(pool),
    }).toEqual({
      result: 2,
      stored: ['attempt 2'],
      pool: { total: 1, idle: 1, waiting: 0 },
    });
  });

  it('asks what became of a COMMIT whose answer was lost to a broken pipe, and keeps its result', async () => {
    const pool = server.openPool({ max: 1 });
    const dialect = new SessionSeamDialect({ pool: commitCheckedPool(pool) });
    const runner = new PostgresUnitOfWorkRunner(
      openPostgresDatabase(pool, dialect),
      rerunAtOnce,
    );
    dialect.lostCommitAnswer = () => systemError('EPIPE', 'write');
    let attempts = 0;

    const result = await runner.run(async (unitOfWork) => {
      attempts += 1;
      await note(unitOfWork, 'landed');
      return 'kept';
    });

    expect({ result, attempts, stored: await server.probeNotes() }).toEqual({
      result: 'kept',
      attempts: 1,
      stored: ['landed'],
    });
  });

  it('runs a unit of work opened inside another on a connection of its own', async () => {
    const { pool, runner } = open(2);

    const sessions = await runner.run(async (outer) => {
      await note(outer, 'outer');
      const inner = await runner.run(async (unitOfWork) => {
        await note(unitOfWork, 'inner');
        return pidOf(unitOfWork);
      });
      return { outer: await pidOf(outer), inner };
    });

    expect({
      sameSession: sessions.outer === sessions.inner,
      stored: await server.probeNotes(),
      pool: countersOf(pool),
    }).toEqual({
      sameSession: false,
      stored: ['inner', 'outer'],
      pool: { total: 2, idle: 2, waiting: 0 },
    });
  });

  it('refuses a unit of work opened inside another when the pool has no second connection', async () => {
    const pool = server.openPool({ max: 1, connectionTimeoutMillis: 200 });
    const runner = new PostgresUnitOfWorkRunner(openPostgresDatabase(pool));

    const inner = await runner.run(() =>
      runner.run(() => Promise.resolve('ran')).catch((error: unknown) => error),
    );

    expect({
      timedOut: inner instanceof PersistenceTimeoutError,
      pool: countersOf(pool),
    }).toEqual({
      timedOut: true,
      pool: { total: 1, idle: 1, waiting: 0 },
    });
  });

  it('holds no slot after a connection could not be opened at all', async () => {
    const pool = server.openPool({
      max: 1,
      connectionString: undefined,
      host: '127.0.0.1',
      port: await closedPort(),
    });
    const runner = new PostgresUnitOfWorkRunner(openPostgresDatabase(pool));

    const refused = await runner
      .run(() => Promise.resolve('ran'))
      .catch((error: unknown) => error);

    expect({
      unavailable: refused instanceof PersistenceUnavailableError,
      pool: countersOf(pool),
    }).toEqual({
      unavailable: true,
      pool: { total: 0, idle: 0, waiting: 0 },
    });
  });
});

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CompiledQuery,
  DatabaseConnection,
  Driver,
  Kysely,
  PostgresDialect,
  sql,
} from 'kysely';
import { Client, Pool, PoolConfig } from 'pg';
import { ignoreSessionEnd } from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
  PostgresTestServer,
  startPostgresTestServer,
} from '../../../../test/postgres/server/postgres-test-server';
import { openPostgresPool, postgresPoolConfig } from './postgres-connection';
import { PostgresTables } from './postgres-database';

/**
 * How long a case's pool waits for a free connection. Short, so a connection
 * that was never handed back fails its case with the pool's own refusal and
 * not at the suite's bound.
 */
export const CASE_POOL_WAIT_MS = 2_000;

/** How long the server may take to report an ended session gone. */
const SESSION_END_WAIT_MS = 30_000;

/** The table a case writes to, to see what a later commit stored. */
export const PROBE_TABLE = 'session_loss_probe';
/** A table whose rows hold their COMMIT for a minute, so one can be caught in flight. */
export const SLOW_COMMIT_TABLE = 'session_loss_slow_commit';

const SCHEMA = `
  CREATE TABLE ${PROBE_TABLE} (note text NOT NULL);
  CREATE TABLE ${SLOW_COMMIT_TABLE} (note text NOT NULL);
  CREATE FUNCTION session_loss_wait() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(60); RETURN NULL; END $$;
  CREATE CONSTRAINT TRIGGER session_loss_wait_at_commit
    AFTER INSERT ON ${SLOW_COMMIT_TABLE}
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION session_loss_wait();`;

export interface PoolCounters {
  total: number;
  idle: number;
  waiting: number;
}

export function countersOf(pool: Pool): PoolCounters {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export interface SessionLossServer {
  url: () => string;
  /** A pool built by the production function on the production settings. */
  openPool: (overrides?: Partial<PoolConfig>) => Pool;
  /** Ends one session from an administrator's connection and waits for it to go. */
  endSession: (pid: number) => Promise<void>;
  /** The notes the probe table holds, as an administrator reads them. */
  probeNotes: () => Promise<string[]>;
  /** Resolves when the production wiring logs the next connection error. */
  nextConnectionError: () => Promise<void>;
}

/**
 * The adapter's dialect with two seams at the driver: what happens just before
 * BEGIN is sent, and a COMMIT that lands while its answer is lost.
 */
export class SessionSeamDialect extends PostgresDialect {
  beforeBegin: ((connection: DatabaseConnection) => Promise<void>) | undefined;
  /** What the driver raises in place of the answer to a COMMIT that landed. */
  lostCommitAnswer: (() => Error) | undefined;

  createDriver(): Driver {
    const driver = super.createDriver();
    const begin = driver.beginTransaction.bind(driver);
    const commit = driver.commitTransaction.bind(driver);
    driver.beginTransaction = async (connection, settings) => {
      await this.beforeBegin?.(connection);
      return begin(connection, settings);
    };
    driver.commitTransaction = async (connection) => {
      await commit(connection);
      if (this.lostCommitAnswer) {
        throw this.lostCommitAnswer();
      }
    };
    return driver;
  }
}

/** A socket failure as Node raises it, with the name, number and call it failed in. */
export function systemError(code: string, syscall: string): Error {
  return Object.assign(new Error(`${syscall} ${code}`), {
    errno: -1,
    code,
    syscall,
  });
}

export async function backendPidOfConnection(
  connection: DatabaseConnection,
): Promise<number> {
  const asked = await connection.executeQuery<{ pid: number }>(
    CompiledQuery.raw('SELECT pg_backend_pid() AS pid'),
  );
  return asked.rows[0].pid;
}

export async function backendPidOf(
  executor: Kysely<PostgresTables>,
): Promise<number> {
  const asked = await sql<{ pid: number }>`
    SELECT pg_backend_pid() AS pid
  `.execute(executor);
  return asked.rows[0].pid;
}

/** One server for the calling suite, with an administrator beside the pools under test. */
export function useSessionLossServer(): SessionLossServer {
  let server: PostgresTestServer;
  let admin: Client;
  let errorLog: jest.SpyInstance;
  const pools: Pool[] = [];

  beforeAll(async () => {
    server = await startPostgresTestServer();
    admin = new Client(server.connection);
    await admin.connect();
    await admin.query(SCHEMA);
  }, POSTGRES_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await admin.query(`DELETE FROM ${PROBE_TABLE}`);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
      pools
        .splice(0)
        .filter((pool) => !pool.ended)
        .map((pool) => pool.end()),
    );
  });

  afterAll(async () => {
    admin?.on('error', ignoreSessionEnd);
    await admin?.end();
    await server?.stop();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  const url = (): string => {
    const { user, password, host, port, database } = server.connection;
    return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  };

  return {
    url,
    openPool: (overrides = {}) => {
      const pool = openPostgresPool({
        ...postgresPoolConfig(new ConfigService({ POSTGRES_URL: url() })),
        connectionTimeoutMillis: CASE_POOL_WAIT_MS,
        ...overrides,
      });
      pools.push(pool);
      return pool;
    },
    endSession: async (pid) => {
      const ended = await admin.query<{ ended: boolean }>(
        'SELECT pg_terminate_backend($1, $2) AS ended',
        [pid, SESSION_END_WAIT_MS],
      );
      if (ended.rows[0]?.ended !== true) {
        throw new Error(`Session ${pid} was not ended`);
      }
    },
    probeNotes: async () => {
      const found = await admin.query<{ note: string }>(
        `SELECT note FROM ${PROBE_TABLE} ORDER BY note`,
      );
      return found.rows.map(({ note }) => note);
    },
    nextConnectionError: () =>
      new Promise<void>((resolve) => {
        errorLog.mockImplementationOnce(() => resolve());
      }),
  };
}

import { Driver, PostgresDialect, sql } from 'kysely';
import { Client } from 'pg';
import { postgresTransactionOf } from '../../../src/common/persistence/postgres/postgres-unit-of-work';
import { TestConnection } from '../postgres-connection';
import { PostgresIssuanceHarness } from '../postgres-issuance-harness';
import { rerunAtOnce } from '../../utils/session/issuance-contract/issuance-contract-support';

export const FAILED_ON_PURPOSE = 'failed on purpose with a transaction open';

/**
 * Jest budget for a case that fails on purpose. Kept apart from every other
 * budget in the report: a case that hangs fails by naming this number, not by
 * the planned failure.
 */
export const PLANNED_FAILURE_BUDGET_MS = 2000;

/** What a case left behind on the server, as the server itself reports it. */
export interface OpenWork {
  accounts: number;
  /** Sessions inside a transaction that are running nothing. */
  holding: number;
  /** Sessions whose statement waits on a lock. */
  waiting: number;
}

/** One account, taken by a session that never ends, and one statement waiting on it. */
export const ABANDONED_WORK: OpenWork = { accounts: 1, holding: 1, waiting: 1 };

export async function openWorkOn(
  harness: Pick<TestConnection, 'pool'>,
): Promise<OpenWork> {
  const counted = await harness.pool.query<Record<keyof OpenWork, string>>(
    `SELECT (SELECT count(*) FROM users) AS accounts,
            count(*) FILTER (WHERE state = 'idle in transaction') AS holding,
            count(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()`,
  );
  const [row] = counted.rows;
  return {
    accounts: Number.parseInt(row.accounts, 10),
    holding: Number.parseInt(row.holding, 10),
    waiting: Number.parseInt(row.waiting, 10),
  };
}

/**
 * Leaves what a case that fails or runs out of its budget leaves: one unit of
 * work that holds an account and never ends, and a second one whose statement
 * waits on that account. Resolves once the server reports the second waiting.
 */
export async function abandonWorkOnAnAccount(
  harness: PostgresIssuanceHarness,
): Promise<void> {
  const userId = await harness.seedAccount();
  const never = new Promise<void>(() => undefined);
  const takeAccount = (
    unitOfWork: Parameters<typeof postgresTransactionOf>[0],
  ) =>
    sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`.execute(
      postgresTransactionOf(unitOfWork),
    );

  await new Promise<void>((taken) => {
    void harness
      .runner(rerunAtOnce)
      .run(async (unitOfWork) => {
        await takeAccount(unitOfWork);
        taken();
        await never;
      })
      .catch(() => undefined);
  });
  void harness
    .runner(rerunAtOnce)
    .run(async (unitOfWork) => {
      await takeAccount(unitOfWork);
    })
    .catch(() => undefined);

  for (;;) {
    const waiting = await harness.pool.query(
      `SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock'`,
    );
    if (waiting.rowCount === 1) {
      return;
    }
  }
}

/** Runs one step just before the next statement is given its connection. */
export class StepBeforeNextStatement extends PostgresDialect {
  private step: (() => Promise<void>) | undefined;

  beforeNextStatement(step: () => Promise<void>): void {
    this.step = step;
  }

  createDriver(): Driver {
    const driver = super.createDriver();
    const acquire = driver.acquireConnection.bind(driver);
    driver.acquireConnection = async () => {
      const step = this.step;
      this.step = undefined;
      await step?.();
      return acquire();
    };
    return driver;
  }
}

export interface InterruptedReset {
  /** Settles once the reset that was left running finished or was ended. */
  settled: Promise<void>;
}

/**
 * Leaves what a reset that runs out of its budget leaves: its statement still
 * running. Another session takes an account after the reset rolled open work
 * back, so the statement waits on it. Resolves once the server reports that
 * wait.
 */
export async function interruptAReset(
  connection: TestConnection<StepBeforeNextStatement>,
): Promise<InterruptedReset> {
  const account = await connection.database
    .insertInto('users')
    .values({ is_deleted: false })
    .returning('id')
    .executeTakeFirstOrThrow();
  const holder = new Client(connection.server.connection);
  // The next reset ends this session, which the client reports as an error.
  holder.on('error', () => undefined);
  const taken = new Promise<void>((resolve) => {
    connection.dialect.beforeNextStatement(async () => {
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        account.id,
      ]);
      resolve();
    });
  });
  const settled = connection.reset().then(
    () => undefined,
    () => undefined,
  );

  // Asking earlier would be open work that the reset itself rolls back.
  await taken;
  for (;;) {
    const waiting = await connection.pool.query(
      `SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock'`,
    );
    if (waiting.rowCount === 1) {
      return { settled };
    }
  }
}

export async function storedAccounts(
  harness: Pick<TestConnection, 'pool'>,
): Promise<number> {
  const counted = await harness.pool.query<{ total: string }>(
    'SELECT count(*) AS total FROM users',
  );
  return Number.parseInt(counted.rows[0].total, 10);
}

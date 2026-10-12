import { ControlledTransaction, Kysely, sql, Transaction } from 'kysely';
import { UnknownTransactionOutcomeError } from '../../exceptions/unknown-transaction-outcome.error';
import { RetryableAbortError } from '../persistence-errors';
import {
  MAX_UNIT_OF_WORK_ATTEMPTS,
  pauseBeforeRerun,
  RerunPause,
  UnitOfWork,
  UnitOfWorkRunner,
} from '../unit-of-work';
import { PostgresTables } from './postgres-database';
import { mapPostgresError, sqlStateOf } from './postgres-persistence-errors';

class PostgresUnitOfWork extends UnitOfWork {
  constructor(readonly transaction: Transaction<PostgresTables>) {
    super();
  }
}

/** The open transaction, for the PostgreSQL adapter only. */
export function postgresTransactionOf(
  unitOfWork: UnitOfWork,
): Transaction<PostgresTables> {
  if (!(unitOfWork instanceof PostgresUnitOfWork)) {
    throw new Error('This unit of work was not opened on PostgreSQL');
  }
  return unitOfWork.transaction;
}

/** What `pg_xact_status` says of a transaction whose commit was not answered. */
export const TRANSACTION_STATUS = {
  COMMITTED: 'committed',
  ABORTED: 'aborted',
} as const;

export const LOST_ANSWER = {
  COMMITTED: 'committed',
  NOT_COMMITTED: 'not_committed',
  UNKNOWN: 'unknown',
} as const;

export type LostAnswerOutcome = (typeof LOST_ANSWER)[keyof typeof LOST_ANSWER];

/**
 * Only the two final states settle a lost answer. `in progress`, a transaction
 * too old to be known, or anything else leaves the outcome unknown.
 */
export function lostAnswerOutcome(status: unknown): LostAnswerOutcome {
  if (status === TRANSACTION_STATUS.COMMITTED) {
    return LOST_ANSWER.COMMITTED;
  }
  if (status === TRANSACTION_STATUS.ABORTED) {
    return LOST_ANSWER.NOT_COMMITTED;
  }
  return LOST_ANSWER.UNKNOWN;
}

/**
 * Read committed, as the plan decided. What must not interleave is kept apart by
 * a row lock the store takes, not by the isolation level.
 */
export class PostgresUnitOfWorkRunner extends UnitOfWorkRunner {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly pause: RerunPause = pauseBeforeRerun,
  ) {
    super();
  }

  async run<Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> {
    for (let failed = 1; ; failed += 1) {
      try {
        return await this.attempt(work);
      } catch (error) {
        const final = failed >= MAX_UNIT_OF_WORK_ATTEMPTS;
        if (final || !(error instanceof RetryableAbortError)) {
          throw error;
        }
        await this.pause(failed);
      }
    }
  }

  /**
   * One run of the work on a connection this method holds from before BEGIN
   * until the transaction has ended or been given up, and hands back whatever
   * happened. The lost-answer question is asked after that, on another one.
   */
  private async attempt<Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> {
    let ended: Ended<Result>;
    try {
      ended = await this.database
        .connection()
        .execute((connection) => inTransaction(connection, work));
    } catch (error) {
      throw mapPostgresError(error);
    }
    if (ended.lost === undefined) {
      return ended.result;
    }
    return this.afterLostAnswer(
      ended.lost.failure,
      ended.transactionId,
      ended.result,
    );
  }

  /**
   * The commit was sent and no answer came. The transaction's id was noted
   * before the work ran, so the primary is asked what became of it, on another
   * connection. Committed: the work is stored and its result stands. Aborted:
   * nothing is stored, and running the work again is safe. Anything else, or no
   * answer to the question either, is an unknown outcome and is never rerun.
   */
  private async afterLostAnswer<Result>(
    lost: unknown,
    transactionId: string,
    result: Result,
  ): Promise<Result> {
    let outcome: LostAnswerOutcome;
    try {
      const asked = await sql<{ status: string | null }>`
        SELECT pg_xact_status(${transactionId}::xid8) AS status
      `.execute(this.database);
      outcome = lostAnswerOutcome(asked.rows[0]?.status);
    } catch {
      outcome = LOST_ANSWER.UNKNOWN;
    }
    if (outcome === LOST_ANSWER.COMMITTED) {
      return result;
    }
    if (outcome === LOST_ANSWER.NOT_COMMITTED) {
      throw new RetryableAbortError(lost);
    }
    throw new UnknownTransactionOutcomeError(lost);
  }
}

/** How one run ended: committed, or its COMMIT went unanswered. */
interface Ended<Result> {
  result: Result;
  transactionId: string;
  lost?: { failure: unknown };
}

async function inTransaction<Result>(
  connection: Kysely<PostgresTables>,
  work: (unitOfWork: UnitOfWork) => Promise<Result>,
): Promise<Ended<Result>> {
  const transaction = await connection
    .startTransaction()
    .setIsolationLevel('read committed')
    .execute();
  let result: Result;
  let transactionId: string;
  try {
    transactionId = await transactionIdOf(transaction);
    result = await work(new PostgresUnitOfWork(transaction));
  } catch (error) {
    await rollBack(transaction);
    throw error;
  }
  try {
    await transaction.commit().execute();
  } catch (error) {
    await rollBack(transaction);
    if (sqlStateOf(error) !== undefined) {
      throw commitFailure(error);
    }
    return { result, transactionId, lost: { failure: error } };
  }
  return { result, transactionId };
}

/**
 * Rolls back. The first failure is the one reported, so a failure here is
 * dropped: the connection is not kept after it (`commitCheckedPool`).
 */
async function rollBack(
  transaction: ControlledTransaction<PostgresTables>,
): Promise<void> {
  try {
    await transaction.rollback().execute();
  } catch {
    return;
  }
}

/**
 * A SQLSTATE means the server answered and the commit did not happen. That
 * includes a COMMIT answered with ROLLBACK because `work` swallowed a store
 * failure: the connection reads the command tag (`commitCheckedPool`), so a
 * normal return from `run` always means the work was committed. Without a
 * SQLSTATE the answer was lost, and `afterLostAnswer` asks what happened.
 */
function commitFailure(error: unknown): unknown {
  return mapPostgresError(error);
}

/**
 * Gives the transaction its id now, while the connection is known to work. The
 * id is what `pg_xact_status` is asked about if the commit's answer is lost.
 */
async function transactionIdOf(
  transaction: Transaction<PostgresTables>,
): Promise<string> {
  const assigned = await sql<{ id: string }>`
    SELECT pg_current_xact_id()::text AS id
  `.execute(transaction);
  const id = assigned.rows[0]?.id;
  if (id === undefined) {
    throw new Error('The transaction was given no id');
  }
  return id;
}

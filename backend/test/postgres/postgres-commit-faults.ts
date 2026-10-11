import {
  DatabaseConnection,
  Driver,
  PostgresDialect,
  PostgresDialectConfig,
} from 'kysely';
import { LostCommitAnswers } from '../utils/session/issuance-contract/issuance-contract-harness';

export interface CommitFault {
  lands: boolean;
  /**
   * How many commit answers are lost. Left out, every answer is lost until
   * restored, and so is the answer to "what became of that transaction": the
   * database cannot be reached at all.
   */
  times?: number;
  /** Awaited after the commit ran or was abandoned, before its answer is lost. */
  beforeSilence?: () => Promise<void>;
}

const STATUS_QUESTION = 'pg_xact_status';

/** What the driver raises when the connection drops before an answer arrives. */
function connectionLost(): Error {
  return Object.assign(new Error('the commit reply was lost'), {
    code: 'ECONNRESET',
  });
}

/**
 * The one place that reaches the driver's commit. With a fault set, the real
 * commit runs first (`lands`) or is replaced by a rollback, and its answer is
 * then lost. Nothing else about the driver changes.
 */
export class CommitFaultDialect extends PostgresDialect {
  private fault: CommitFault | undefined;
  private attempts = 0;
  private readonly watched = new WeakSet<DatabaseConnection>();

  constructor(config: PostgresDialectConfig) {
    super(config);
  }

  loseCommitAnswers(fault: CommitFault): LostCommitAnswers {
    this.fault = fault;
    this.attempts = 0;
    return {
      commitAttempts: () => this.attempts,
      restore: () => {
        this.fault = undefined;
      },
    };
  }

  createDriver(): Driver {
    const driver = super.createDriver();
    const commit = driver.commitTransaction.bind(driver);
    const acquire = driver.acquireConnection.bind(driver);
    driver.commitTransaction = async (connection) => {
      const fault = this.fault;
      if (
        !fault ||
        (fault.times !== undefined && this.attempts >= fault.times)
      ) {
        return commit(connection);
      }
      this.attempts += 1;
      if (fault.lands) {
        await commit(connection);
      } else {
        await driver.rollbackTransaction(connection);
      }
      await fault.beforeSilence?.();
      throw connectionLost();
    };
    driver.acquireConnection = async () => this.watch(await acquire());
    return driver;
  }

  /** Loses the answer to the status question while nothing can be reached. */
  private watch(connection: DatabaseConnection): DatabaseConnection {
    if (this.watched.has(connection)) {
      return connection;
    }
    this.watched.add(connection);
    const execute = connection.executeQuery.bind(connection);
    connection.executeQuery = (query) => {
      const unreachable = this.fault && this.fault.times === undefined;
      if (unreachable && query.sql.includes(STATUS_QUESTION)) {
        return Promise.reject(connectionLost());
      }
      return execute(query);
    };
    return connection;
  }
}

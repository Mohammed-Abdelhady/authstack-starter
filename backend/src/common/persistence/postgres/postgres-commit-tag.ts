import {
  PostgresCursor,
  PostgresPool,
  PostgresPoolClient,
  PostgresQueryResult,
} from 'kysely';
import { endsSession, SQLSTATE } from './postgres-persistence-errors';

const COMMIT_STATEMENT = 'commit';
const COMMITTED_TAG = 'COMMIT';

/**
 * PostgreSQL answers COMMIT on a failed transaction with the tag ROLLBACK and
 * no error. This is that answer, raised under the state the server gives any
 * other statement sent to a failed transaction.
 */
export class RolledBackAtCommitError extends Error {
  readonly code = SQLSTATE.IN_FAILED_SQL_TRANSACTION;

  constructor(readonly commandTag: string) {
    super(
      `COMMIT was answered with ${commandTag}: a statement had failed and nothing was stored`,
    );
    this.name = 'RolledBackAtCommitError';
  }
}

/** A pooled client the pool closes, instead of keeping, when told to. */
export interface DroppablePoolClient extends PostgresPoolClient {
  release(drop?: boolean): void;
}

export interface DroppingPool extends Pick<PostgresPool, 'options' | 'Client'> {
  connect(): Promise<DroppablePoolClient>;
  end(): Promise<void>;
}

class CommitCheckedClient implements PostgresPoolClient {
  /**
   * Set when a statement went unanswered or the server ended the session.
   * What the session still holds is then not known, an open transaction
   * included.
   */
  private spent = false;

  constructor(private readonly client: DroppablePoolClient) {}

  get processID(): PostgresPoolClient['processID'] {
    return this.client.processID;
  }

  query<R>(
    sql: string,
    parameters: ReadonlyArray<unknown>,
  ): Promise<PostgresQueryResult<R>>;
  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(
    statement: string | PostgresCursor<R>,
    parameters: ReadonlyArray<unknown> = [],
  ): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof statement !== 'string') {
      return this.client.query(statement);
    }
    const answer = this.answered(this.client.query<R>(statement, parameters));
    return isCommit(statement) ? committed(answer) : answer;
  }

  /** Closes the connection when its session is not known to be clean. */
  release(): void {
    this.client.release(this.spent);
  }

  private async answered<Answer>(answer: Promise<Answer>): Promise<Answer> {
    try {
      return await answer;
    } catch (error) {
      if (endsSession(error)) {
        this.spent = true;
      }
      throw error;
    }
  }
}

function isCommit(statement: string): boolean {
  return statement.trim().toLowerCase() === COMMIT_STATEMENT;
}

async function committed<R>(
  answer: Promise<PostgresQueryResult<R>>,
): Promise<PostgresQueryResult<R>> {
  const result = await answer;
  const commandTag: string = result.command;
  if (commandTag !== COMMITTED_TAG) {
    throw new RolledBackAtCommitError(commandTag);
  }
  return result;
}

/**
 * The pool the query builder is given. Every COMMIT it sends has its command
 * tag read, so a commit that stored nothing is a failure and never a normal
 * return. One round trip, where a probe statement before COMMIT took two.
 *
 * A connection is kept for the next caller only while every statement on it
 * was answered by a session that goes on. After one that was not, a ROLLBACK
 * or BEGIN among them, it is closed when it is handed back.
 */
export function commitCheckedPool(pool: DroppingPool): PostgresPool {
  // The query builder keys its own connection state by client object.
  const checked = new WeakMap<DroppablePoolClient, CommitCheckedClient>();
  return {
    options: pool.options,
    ...(pool.Client === undefined ? {} : { Client: pool.Client }),
    connect: async () => {
      const client = await pool.connect();
      const known = checked.get(client);
      if (known) {
        return known;
      }
      const wrapped = new CommitCheckedClient(client);
      checked.set(client, wrapped);
      return wrapped;
    },
    end: () => pool.end(),
  };
}

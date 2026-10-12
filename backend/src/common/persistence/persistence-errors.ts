import { UnknownTransactionOutcomeError } from '../exceptions/unknown-transaction-outcome.error';

export const PERSISTENCE_ERROR_KIND = {
  UNIQUE_CONFLICT: 'unique_conflict',
  MALFORMED_ID: 'malformed_id',
  RETRYABLE_ABORT: 'retryable_abort',
  TIMEOUT: 'timeout',
  UNAVAILABLE: 'unavailable',
} as const;

export type PersistenceErrorKind =
  (typeof PERSISTENCE_ERROR_KIND)[keyof typeof PERSISTENCE_ERROR_KIND];

/** What an adapter raises instead of its driver's own error. */
export abstract class PersistenceError extends Error {
  abstract readonly kind: PersistenceErrorKind;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = new.target.name;
  }
}

/** A unique rule refused the write. `constraint` is the rule's shared name. */
export class UniqueConflictError extends PersistenceError {
  readonly kind = PERSISTENCE_ERROR_KIND.UNIQUE_CONFLICT;

  constructor(
    readonly constraint: string,
    cause?: unknown,
  ) {
    super(`A unique rule refused the write: ${constraint}`, cause);
  }
}

/** The id is not one this database could have issued. */
export class MalformedIdError extends PersistenceError {
  readonly kind = PERSISTENCE_ERROR_KIND.MALFORMED_ID;

  constructor(cause?: unknown) {
    super('The id is malformed', cause);
  }
}

/** Nothing was written and running the same work again may succeed. */
export class RetryableAbortError extends PersistenceError {
  readonly kind = PERSISTENCE_ERROR_KIND.RETRYABLE_ABORT;

  constructor(cause?: unknown) {
    super('The unit of work was aborted and can be run again', cause);
  }
}

export class PersistenceTimeoutError extends PersistenceError {
  readonly kind = PERSISTENCE_ERROR_KIND.TIMEOUT;

  constructor(cause?: unknown) {
    super('The database did not answer in time', cause);
  }
}

export class PersistenceUnavailableError extends PersistenceError {
  readonly kind = PERSISTENCE_ERROR_KIND.UNAVAILABLE;

  constructor(cause?: unknown) {
    super('The database is unavailable', cause);
  }
}

/** The sixth shared error: the commit was sent and its answer never came. */
export { UnknownTransactionOutcomeError };

export function isPersistenceError(error: unknown): error is PersistenceError {
  return error instanceof PersistenceError;
}

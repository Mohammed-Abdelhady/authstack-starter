import { isUnknownTransactionOutcome } from '../exceptions/unknown-transaction-outcome.error';
import { describeDriverError } from '../utils/describe-error.util';
import {
  isPersistenceError,
  PERSISTENCE_ERROR_KIND,
  PersistenceErrorKind,
} from './persistence-errors';
import { UnitOfWork, UnitOfWorkRunner } from './unit-of-work';

const OUTAGE_KINDS: ReadonlySet<PersistenceErrorKind> = new Set([
  PERSISTENCE_ERROR_KIND.RETRYABLE_ABORT,
  PERSISTENCE_ERROR_KIND.TIMEOUT,
  PERSISTENCE_ERROR_KIND.UNAVAILABLE,
]);

/** True for an outage, an exhausted rerun, or a commit with no answer. */
export function isStoreOutage(error: unknown): boolean {
  if (isUnknownTransactionOutcome(error)) {
    return true;
  }
  return isPersistenceError(error) && OUTAGE_KINDS.has(error.kind);
}

/** The database failure under a shared error, or the error itself. */
export function storeFailureCause(error: unknown): unknown {
  return isPersistenceError(error) && error.cause !== undefined
    ? error.cause
    : error;
}

/**
 * Names the failure for a log line. A shared persistence error is named by the
 * database failure under it, which is what an operator has to look up.
 */
export function describeStoreFailure(error: unknown): string {
  return describeDriverError(storeFailureCause(error));
}

/**
 * Runs a unit of work for a caller that never answered a database failure
 * itself. The failure leaves as the database raised it, so the answer and the
 * log line the global filter gives stay what they were before stores.
 */
export async function runLeavingFailuresAsRaised<Result>(
  runner: UnitOfWorkRunner,
  work: (unitOfWork: UnitOfWork) => Promise<Result>,
): Promise<Result> {
  try {
    return await runner.run(work);
  } catch (error) {
    throw storeFailureCause(error);
  }
}

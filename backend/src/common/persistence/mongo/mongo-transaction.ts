import { ClientSession, Connection } from 'mongoose';
import { UnknownTransactionOutcomeError } from '../../exceptions/unknown-transaction-outcome.error';
import { pauseBeforeRerun, RerunPause } from '../unit-of-work';

export {
  isUnknownTransactionOutcome,
  UnknownTransactionOutcomeError,
} from '../../exceptions/unknown-transaction-outcome.error';

const MAX_TRANSACTION_ATTEMPTS = 3;
const MAX_COMMIT_ATTEMPTS = 3;
export const UNKNOWN_COMMIT_RESULT_LABEL = 'UnknownTransactionCommitResult';
const TRANSIENT_TRANSACTION_ERROR_LABEL = 'TransientTransactionError';

function hasErrorLabel(error: unknown, label: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const labels = (error as { errorLabels?: unknown }).errorLabels;
  return Array.isArray(labels) && labels.includes(label);
}

function isTransientTransactionError(error: unknown): boolean {
  return (
    hasErrorLabel(error, TRANSIENT_TRANSACTION_ERROR_LABEL) ||
    isCatalogRetry(error, new Set())
  );
}

function isCatalogRetry(error: unknown, seen: Set<unknown>): boolean {
  if (typeof error !== 'object' || error === null || seen.has(error)) {
    return false;
  }
  seen.add(error);
  const message = error instanceof Error ? error.message : '';
  if (
    message.includes('catalog changes') ||
    message.includes('Please retry your operation')
  ) {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  return isCatalogRetry(cause, seen);
}

export async function withMajorityTransaction<T>(
  connection: Connection,
  work: (session: ClientSession) => Promise<T>,
  pause: RerunPause = pauseBeforeRerun,
): Promise<T> {
  const session = await connection.startSession();
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      let commitOutcomeUnknown = false;
      try {
        session.startTransaction({
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
        });
        const result = await work(session);
        for (
          let commitAttempt = 0;
          commitAttempt < MAX_COMMIT_ATTEMPTS;
          commitAttempt += 1
        ) {
          try {
            commitOutcomeUnknown = true;
            await session.commitTransaction();
            commitOutcomeUnknown = false;
            return result;
          } catch (error) {
            if (hasErrorLabel(error, TRANSIENT_TRANSACTION_ERROR_LABEL)) {
              commitOutcomeUnknown = false;
              throw error;
            }
            commitOutcomeUnknown = true;
            if (!hasErrorLabel(error, UNKNOWN_COMMIT_RESULT_LABEL))
              throw new UnknownTransactionOutcomeError(error);
            if (commitAttempt === MAX_COMMIT_ATTEMPTS - 1) {
              throw new UnknownTransactionOutcomeError(error);
            }
          }
        }
      } catch (error) {
        if (session.inTransaction() && !commitOutcomeUnknown) {
          try {
            await session.abortTransaction();
          } catch (abortError) {
            if (!(error instanceof Error)) {
              throw abortError;
            }
          }
        }
        lastError = error;
        const canRetry =
          !commitOutcomeUnknown &&
          isTransientTransactionError(error) &&
          attempt < MAX_TRANSACTION_ATTEMPTS - 1;
        if (!canRetry) {
          throw error;
        }
        await pause(attempt + 1);
      }
    }
    throw lastError;
  } finally {
    await session.endSession();
  }
}

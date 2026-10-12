import {
  MONGO_TRANSIENT_TRANSACTION_LABEL,
  MONGO_UNAVAILABLE_CODES,
} from '../../constants/mongo-errors';
import { isUnknownTransactionOutcome } from '../../exceptions/unknown-transaction-outcome.error';
import {
  MalformedIdError,
  PersistenceTimeoutError,
  PersistenceUnavailableError,
  RetryableAbortError,
  UniqueConflictError,
} from '../persistence-errors';
import {
  isCastError,
  isDatabaseUnavailableError,
  isMongoDuplicateKeyError,
} from './mongo-error.util';

/** MaxTimeMSExpired, NetworkTimeout, ExceededTimeLimit. */
const MONGO_TIMEOUT_CODES: ReadonlySet<number> = new Set([50, 89, 262]);

const INDEX_NAME_PATTERN = / index: (\S+) dup key/;

const UNNAMED_CONSTRAINT = 'unnamed';

/** Index name to the rule's shared name. An unlisted index keeps its own name. */
export type MongoIndexConstraints = Readonly<Record<string, string>>;

/** The shared name of the unique rule a duplicate-key error ran into. */
export function mongoConstraintOf(
  error: { message: string },
  constraints: MongoIndexConstraints,
): string {
  const index = INDEX_NAME_PATTERN.exec(error.message)?.[1];
  if (!index) {
    return UNNAMED_CONSTRAINT;
  }
  return constraints[index] ?? index;
}

function hasLabel(error: unknown, label: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if (!('errorLabels' in error) || !Array.isArray(error.errorLabels)) {
    return false;
  }
  const labels: unknown[] = error.errorLabels;
  return labels.includes(label);
}

function codeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'number' ? error.code : undefined;
}

const NO_CONSTRAINTS: MongoIndexConstraints = {};

/**
 * The shared error for a driver failure. Anything else, an application error or
 * one that is already shared, comes back as it went in.
 */
export function mapMongoDriverError(
  error: unknown,
  constraints: MongoIndexConstraints = NO_CONSTRAINTS,
): unknown {
  if (isMongoDuplicateKeyError(error)) {
    return new UniqueConflictError(
      mongoConstraintOf(error, constraints),
      error,
    );
  }
  if (isCastError(error)) {
    return new MalformedIdError(error);
  }
  if (hasLabel(error, MONGO_TRANSIENT_TRANSACTION_LABEL)) {
    return new RetryableAbortError(error);
  }
  const code = codeOf(error);
  if (code !== undefined && MONGO_TIMEOUT_CODES.has(code)) {
    return new PersistenceTimeoutError(error);
  }
  if (
    (code !== undefined && MONGO_UNAVAILABLE_CODES.has(code)) ||
    isUnavailable(error)
  ) {
    return new PersistenceUnavailableError(error);
  }
  return error;
}

/** Unknown outcomes are already shared and must not be reported as an outage. */
function isUnavailable(error: unknown): boolean {
  return (
    !isUnknownTransactionOutcome(error) && isDatabaseUnavailableError(error)
  );
}

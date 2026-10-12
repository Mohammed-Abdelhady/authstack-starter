import {
  PersistenceTimeoutError,
  PersistenceUnavailableError,
  UniqueConflictError,
} from '../persistence-errors';
import { isMongoDuplicateKeyError } from './mongo-error.util';
import { mapMongoDriverError, mongoConstraintOf } from './mongo-driver-errors';

/**
 * Runs one insert that commits by itself and turns a refused unique rule into
 * the shared error. `constraints` maps this collection's index names to the
 * rules' shared names; an unlisted index keeps its own name. Every other
 * failure leaves as `singleStatement` would raise it.
 */
export async function insertOrConflict<Result>(
  constraints: Readonly<Record<string, string>>,
  insert: () => Promise<Result>,
): Promise<Result> {
  try {
    return await insert();
  } catch (error) {
    if (!isMongoDuplicateKeyError(error)) {
      throw outageOr(error);
    }
    throw new UniqueConflictError(mongoConstraintOf(error, constraints), error);
  }
}

/**
 * Runs one statement that commits by itself. An outage or a timeout leaves as
 * the shared error, which the global filter answers as it answers the driver
 * error. Anything else leaves as the driver raised it: a duplicate key from a
 * statement that is not an insert is not one a service handles today.
 */
export async function singleStatement<Result>(
  statement: () => Promise<Result>,
): Promise<Result> {
  try {
    return await statement();
  } catch (error) {
    throw outageOr(error);
  }
}

function outageOr(error: unknown): unknown {
  const mapped = mapMongoDriverError(error);
  return mapped instanceof PersistenceUnavailableError ||
    mapped instanceof PersistenceTimeoutError
    ? mapped
    : error;
}

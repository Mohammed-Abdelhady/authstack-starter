import {
  isRefusedId,
  failureText,
  SQLSTATE,
  sqlStateOf,
} from '../utils/sql-state.util';
import { MalformedIdError, UniqueConflictError } from './persistence-errors';

const UNNAMED_CONSTRAINT = 'unnamed';

/**
 * The shared error for a SQL failure that reached the global filter as the
 * driver raised it. A caller that leaves failures as raised hands the filter
 * the driver's own error, and the two the filter answers by themselves are a
 * refused unique rule and a value the database refused as an id. Every other
 * failure, and anything that is not a SQL failure, comes back undefined and is
 * answered as before.
 */
export function sharedErrorOfSqlFailure(
  exception: unknown,
): UniqueConflictError | MalformedIdError | undefined {
  if (typeof exception !== 'object' || exception === null) {
    return undefined;
  }
  const state = sqlStateOf(exception);
  if (state === SQLSTATE.UNIQUE_VIOLATION) {
    return new UniqueConflictError(
      failureText(exception, 'constraint') ?? UNNAMED_CONSTRAINT,
      exception,
    );
  }
  if (isRefusedId(exception)) {
    return new MalformedIdError(exception);
  }
  return undefined;
}

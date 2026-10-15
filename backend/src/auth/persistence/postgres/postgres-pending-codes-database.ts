import {
  MalformedIdError,
  UniqueConflictError,
} from '../../../common/persistence/persistence-errors';
import { mapPostgresError } from '../../../common/persistence/postgres/postgres-persistence-errors';

export { storedAddress } from '../../../common/persistence/stored-address';

/**
 * Runs one statement that commits by itself and maps its failure to the shared
 * errors. `constraints` maps this table's constraint names to the rules' shared
 * names.
 */
export async function autocommit<Result>(
  constraints: Readonly<Record<string, string>>,
  statement: () => Promise<Result>,
): Promise<Result> {
  try {
    return await statement();
  } catch (error) {
    if (error instanceof MalformedIdError) {
      throw error;
    }
    const mapped = mapPostgresError(error);
    if (mapped instanceof UniqueConflictError) {
      throw new UniqueConflictError(
        constraints[mapped.constraint] ?? mapped.constraint,
        error,
      );
    }
    throw mapped;
  }
}

/** Rows a DELETE removed, from the driver's bigint count. */
export function removedRows(result: { numDeletedRows: bigint }): number {
  return Number(result.numDeletedRows);
}

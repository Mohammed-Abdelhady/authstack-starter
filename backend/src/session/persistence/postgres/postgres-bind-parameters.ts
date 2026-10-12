import { RawBuilder, sql } from 'kysely';

/** PostgreSQL counts the parameters bound to one statement in 16 bits. */
export const POSTGRES_MAX_BIND_PARAMETERS = 65_535;

/**
 * The rows in order, in groups one statement can bind when every row sets
 * `columnsPerRow` values. The caller sends each group on the same transaction.
 */
export function rowSlices<Row>(rows: Row[], columnsPerRow: number): Row[][] {
  const size = Math.floor(POSTGRES_MAX_BIND_PARAMETERS / columnsPerRow);
  const slices: Row[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    slices.push(rows.slice(start, start + size));
  }
  return slices;
}

/**
 * `column = ANY(list)` with the whole list as one parameter. An `IN` list
 * binds one parameter per value and is refused past the limit above.
 */
export function anyText(values: string[]): RawBuilder<string> {
  return sql<string>`ANY(${values}::text[])`;
}

/** The same for a `uuid` column. The caller has checked each id's form. */
export function anyUuid(ids: string[]): RawBuilder<string> {
  return sql<string>`ANY(${ids}::uuid[])`;
}

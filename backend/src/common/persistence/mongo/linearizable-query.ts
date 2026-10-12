import { Query } from 'mongoose';

/** How long a linearizable read may wait for a majority before it is given up. */
export const LINEARIZABLE_QUERY_MAX_TIME_MS = 5000;

export function linearizable<Result, Doc>(
  query: Query<Result, Doc>,
): Query<Result, Doc> {
  return query
    .read('primary')
    .readConcern('linearizable')
    .maxTimeMS(LINEARIZABLE_QUERY_MAX_TIME_MS);
}

import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date, Date>;
type OptionalTimestamp = ColumnType<
  Date | null,
  Date | null | undefined,
  Date | null
>;

/** `0029_account_erasure.sql`. */
export interface ErasureJobsTable {
  id: Generated<string>;
  user_id: string;
  step: string;
  attempts: Generated<number>;
  failure_code: string | null;
  failed_at: OptionalTimestamp;
  next_attempt_at: OptionalTimestamp;
  lease_owner: string | null;
  lease_until: OptionalTimestamp;
  started_at: Timestamp;
  erased_at: OptionalTimestamp;
  purge_after: OptionalTimestamp;
}

/** `0029_account_erasure.sql`. */
export interface AccountDeletionReceiptsTable {
  key_hash: string;
  user_id: string;
  operation: string;
  erase_after: OptionalTimestamp;
  recorded_at: Timestamp;
  purge_after: Timestamp;
}

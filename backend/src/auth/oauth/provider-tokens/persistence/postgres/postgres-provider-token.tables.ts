import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date, Date>;
type OptionalTimestamp = ColumnType<
  Date | null,
  Date | null | undefined,
  Date | null
>;

/** `0029_account_erasure.sql`. */
export interface ProviderTokensTable {
  id: Generated<string>;
  provider: string;
  subject: string;
  client_id: string;
  ciphertext: string;
  iv: string;
  tag: string;
  key_id: string;
  stored_at: Timestamp;
  check_after: OptionalTimestamp;
}

/** `0029_account_erasure.sql`. The four token columns are set together or not at all. */
export interface ProviderRevocationsTable {
  id: Generated<string>;
  provider: string;
  subject: string;
  client_id: string | null;
  user_id: string | null;
  reason: string;
  state: string;
  outcome: string | null;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  key_id: string | null;
  attempts: Generated<number>;
  failure_code: string | null;
  flagged_at: OptionalTimestamp;
  next_attempt_at: OptionalTimestamp;
  lease_until: OptionalTimestamp;
  created_at: Timestamp;
  settled_at: OptionalTimestamp;
  purge_after: Timestamp;
}

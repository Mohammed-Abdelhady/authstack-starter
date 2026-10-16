import type { ColumnType } from 'kysely';
import type { StaffOperation } from '../../types/staff-idempotency';

type Timestamp = ColumnType<Date, Date, Date>;

export interface StaffIdempotencyKeysTable {
  actor_id: string;
  client_id: string;
  operation: StaffOperation;
  idempotency_key: string;
  request_hash: string;
  resource_id: string | null;
  created_at: Timestamp;
  expires_at: Timestamp;
}

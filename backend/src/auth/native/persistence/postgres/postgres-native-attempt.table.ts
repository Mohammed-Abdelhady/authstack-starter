import { ColumnType } from 'kysely';
import { NativeAttemptDetails } from '../../types/native-attempt';

type Timestamp = ColumnType<Date, Date, Date>;
export interface NativeAttemptsTable {
  id: string;
  attempt_id: string;
  secret_hash: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string;
  requested_scopes: string[];
  flow: string;
  phase: string;
  auth_epoch: number;
  created_at: Timestamp;
  expires_at: Timestamp;
  revision: number;
  active_operation_id: string | null;
  cancelled_at: Timestamp | null;
  details: ColumnType<NativeAttemptDetails, string, string>;
}

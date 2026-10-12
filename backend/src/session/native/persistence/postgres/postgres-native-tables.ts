// The tables of mobile sign-in, from migration 0010.
import { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date, Date>;

type NullableText = ColumnType<
  string | null,
  string | null | undefined,
  string | null
>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | null | undefined,
  Date | null
>;
type NullableInteger = ColumnType<
  number | null,
  number | null | undefined,
  number | null
>;

export interface AuthorizationTransactionsTable {
  id: Generated<string>;
  transaction_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string;
  requested_scopes: Generated<string[]>;
  audience: NullableText;
  intent: string;
  expires_at: Timestamp;
  consumed: Generated<boolean>;
  user_id: NullableText;
  captured_user_version: NullableInteger;
  captured_client_version: NullableInteger;
  captured_grant_version: NullableInteger;
  auth_epoch: number;
  authentication_methods: Generated<string[]>;
  code_hash: NullableText;
  code_expires_at: NullableTimestamp;
}

export interface NativeCredentialsTable {
  id: Generated<string>;
  token_hash: string;
  purpose: string;
  session_id: string;
  client_id: string;
  generation: number;
  family_id: string;
  issued_at: Timestamp;
  expires_at: Timestamp;
  spent: Generated<boolean>;
  consumed_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  proof_key_thumbprint: NullableText;
  first_used_at: NullableTimestamp;
  successor_access_hash: NullableText;
  successor_refresh_hash: NullableText;
  retry_claim_until: NullableTimestamp;
}

export interface NativeDpopProofIdsTable {
  id: Generated<string>;
  proof_id_hash: string;
  expires_at: Timestamp;
}

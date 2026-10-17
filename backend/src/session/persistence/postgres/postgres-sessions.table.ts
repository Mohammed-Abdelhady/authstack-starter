import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date, Date>;

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  csrf_token: string | null;
  user_agent: string;
  device: ColumnType<unknown, string | null, string | null>;
  device_name: string | null;
  ip: string;
  is_valid: Generated<boolean>;
  revoked_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  revoked_reason: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  client_id: string;
  user_version: number;
  client_version: number;
  grant_version: number;
  auth_epoch: number;
  schema_version: number;
  scopes: string[];
  audience: string;
  authentication_methods: string[];
  credential_purpose: string;
  browser_generation: number;
  authenticated_at: Timestamp;
  /** From 0030: set on a mobile session only, and never changed. */
  issued_at: ColumnType<Date | null, Date | null | undefined, never>;
  last_used_at: Timestamp;
  last_activity_at: Timestamp;
  expires_at: Timestamp;
  idle_expires_at: Timestamp;
  proof_key_thumbprint: ColumnType<
    string | null,
    string | null | undefined,
    string | null
  >;
  created_at: ColumnType<Date, Date | undefined, never>;
  user_verified: Generated<boolean>;
  policy_version: Generated<number>;
}

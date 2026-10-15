import type { ApplicationSignInMethods } from '../../applications/types/application-sign-in-methods';
import type { ColumnType, Generated } from 'kysely';
import type { RoleAudience } from '../../../host/types/host-role.type';
import type { SIGN_UP_POLICY } from '../../../config/constants/host-contracts';

type SignUpPolicy = (typeof SIGN_UP_POLICY)[keyof typeof SIGN_UP_POLICY];

type BigIntColumn = ColumnType<string, number, number>;

export interface ApplicationsTable {
  client_id: string;
  environment: string;
  platform: string;
  enabled: Generated<boolean>;
  session_version: Generated<number>;
  allowed_scopes: Generated<string[]>;
  absolute_lifetime_ms: BigIntColumn;
  idle_lifetime_ms: BigIntColumn;
  display_name: string;
  client_type: string;
  redirect_uris: Generated<string[]>;
  allowed_origins: Generated<string[]>;
  audiences: Generated<string[]>;
  policy_version: Generated<number>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  sign_up: Generated<SignUpPolicy>;
  require_passkey: Generated<boolean>;
  sign_in_methods: ColumnType<
    ApplicationSignInMethods | null,
    string | null | undefined,
    string | null
  >;
  account_audience: ColumnType<
    RoleAudience | null,
    RoleAudience | null | undefined,
    RoleAudience | null
  >;
  session_cap: ColumnType<
    number | null,
    number | null | undefined,
    number | null
  >;
  unbound_absolute_lifetime_ms: ColumnType<
    string | null,
    number | null | undefined,
    number | null
  >;
  unbound_idle_lifetime_ms: ColumnType<
    string | null,
    number | null | undefined,
    number | null
  >;
}

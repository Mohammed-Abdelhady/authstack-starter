import type { EmailChangeInitiator } from '../../../auth/constants/email-change-initiator';
import type { RememberedDevices } from '../../../session/notices/types/device-notice';
import type { ColumnType, Generated } from 'kysely';
import type { RoleAudience } from '../../../host/types/host-role.type';

export interface UsersTable {
  sign_in_devices: ColumnType<
    RememberedDevices | null,
    string | null | undefined,
    string | null
  >;
  id: Generated<string>;
  is_deleted: Generated<boolean>;
  session_version: Generated<number>;
  issuance_fence: Generated<number>;
  role: Generated<string>;
  permissions: Generated<string[]>;
  email: string | null;
  pending_email: string | null;
  pending_email_initiator: ColumnType<
    EmailChangeInitiator | null,
    EmailChangeInitiator | null | undefined,
    EmailChangeInitiator | null
  >;
  name: string | null;
  is_verified: Generated<boolean>;
  auth_provider: string | null;
  primary_provider: string | null;
  password_hash: string | null;
  avatar_url: string | null;
  deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  address_generation: Generated<number>;
  profile_synced_at: ColumnType<
    Date | null,
    Date | null | undefined,
    Date | null
  >;
  last_synced_provider: string | null;
  locale: Generated<string>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  audience: ColumnType<
    RoleAudience | null,
    RoleAudience | null | undefined,
    RoleAudience | null
  >;
  /** `0029_account_erasure.sql`. Null unless a deletion scheduled erasure. */
  erase_after: ColumnType<Date | null, Date | null | undefined, Date | null>;
  /** `0029_account_erasure.sql`. When the person last deleted the account. */
  self_deleted_at: ColumnType<
    Date | null,
    Date | null | undefined,
    Date | null
  >;
  /** Raised by a trigger on every write to a column staff read. */
  version: ColumnType<number, never, never>;
}

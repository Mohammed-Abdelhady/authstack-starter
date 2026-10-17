import type { ColumnType, Generated } from 'kysely';
import type { RoleAudience } from '../../../../host/types/host-role.type';
import type { InvitationPurpose } from '../../types/invitation';

type Timestamp = ColumnType<Date, Date, Date>;
type OptionalTimestamp = ColumnType<
  Date | null,
  Date | null | undefined,
  Date | null
>;

export interface InvitationsTable {
  id: Generated<string>;
  purpose: InvitationPurpose;
  email: string;
  name: string | null;
  role_id: string | null;
  role_slug: string | null;
  audience: RoleAudience | null;
  client_id: string;
  invited_by: string | null;
  user_id: string | null;
  address_generation: number | null;
  locale: Generated<string>;
  token_hash: string;
  expires_at: Timestamp;
  accepted_at: OptionalTimestamp;
  revoked_at: OptionalTimestamp;
  purge_after: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

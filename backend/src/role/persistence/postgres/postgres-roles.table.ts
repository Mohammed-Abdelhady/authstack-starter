import type { ColumnType, Generated } from 'kysely';
import type { RoleAudience } from '../../../host/types/host-role.type';

type Timestamp = ColumnType<Date, Date, Date>;

export interface RolesTable {
  id: Generated<string>;
  name: string;
  slug: string;
  description: string | null;
  is_system_role: Generated<boolean>;
  is_protected: Generated<boolean>;
  level: number | null;
  permissions: Generated<string[]>;
  created_at: Timestamp;
  updated_at: Timestamp;
  audience: ColumnType<
    RoleAudience | null,
    RoleAudience | null | undefined,
    never
  >;
}

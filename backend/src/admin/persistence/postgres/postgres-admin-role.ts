import type { RoleAudience } from '../../../host/types/host-role.type';
import type { AssignableRole } from '../../stores/admin-account.store';

export function assignableRoleOf(
  row: { id: string; slug: string; audience: RoleAudience | null } | undefined,
): AssignableRole | null {
  return row ? { ...row, audience: row.audience ?? undefined } : null;
}

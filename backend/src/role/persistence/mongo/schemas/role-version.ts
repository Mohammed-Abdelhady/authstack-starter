import type { Schema } from 'mongoose';
import { registerRecordVersion } from '../../../../common/persistence/mongo/record-version';
import type { Role } from './role.schema';

/** The role fields staff read. Pending sweeps are bookkeeping and left out. */
const ROLE_VERSION_FIELDS = [
  'name',
  'slug',
  'description',
  'permissions',
  'level',
  'audience',
  'isSystemRole',
  'isProtected',
] as const;

export function registerRoleVersion(schema: Schema<Role>): void {
  registerRecordVersion(schema, ROLE_VERSION_FIELDS);
}

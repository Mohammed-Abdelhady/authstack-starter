import type { Schema } from 'mongoose';
import { registerRecordVersion } from '../../../../common/persistence/mongo/record-version';
import type { User } from './user.schema';

/** The account fields staff read. Session bookkeeping is left out. */
const USER_VERSION_FIELDS = [
  'email',
  'pendingEmail',
  'name',
  'role',
  'permissions',
  'audience',
  'isDeleted',
  'deletedAt',
  'isVerified',
  'password',
  'avatarUrl',
  'locale',
  'addressGeneration',
  'authProvider',
  'primaryProvider',
  'linkedAccounts',
] as const;

export function registerUserVersion(schema: Schema<User>): void {
  registerRecordVersion(schema, USER_VERSION_FIELDS);
}

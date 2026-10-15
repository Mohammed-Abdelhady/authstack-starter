import { SECURITY_EVENT_ACTION as ACTION } from '../../constants/security-event-action';

export const SECURITY_EVENT_KIND = {
  STAFF: 'staff',
  SIGN_IN: 'sign_in',
} as const;
export const ACTIVITY_DEFAULT_LIMIT = 10;
export const ACTIVITY_MAX_LIMIT = 100;
export const ACTIVITY_MAX_PAGE = 1_000_000;
export const ACTIVITY_MAX_OFFSET = 10_000;
export const ACTIVITY_MAX_FILTER_LENGTH = 200;
export const ACTIVITY_FILTER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,199}$/;
export const ACTIVITY_MAX_TEXT_LENGTH = 320;
export const ACTIVITY_DAY_MS = 86_400_000;
export const SIGN_IN_RETENTION_DAYS = 90;

export const ACTIVITY_DETAIL_FIELDS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  [ACTION.ACCOUNT_CREATED]: { name: 'text', email: 'text', roleId: 'id' },
  [ACTION.ACCOUNT_UPDATED]: {
    name: 'text',
    email: 'text',
    changedFields: 'fields',
  },
  [ACTION.ACCOUNT_STATUS_CHANGED]: { isDeleted: 'boolean' },
  [ACTION.ACCOUNT_DELETED]: {},
  [ACTION.PERMISSION_GRANTED]: { permission: 'permission' },
  [ACTION.PERMISSION_REVOKED]: { permission: 'permission' },
  [ACTION.ROLE_CREATED]: { roleId: 'id', slug: 'id' },
  [ACTION.ROLE_UPDATED]: {
    roleId: 'id',
    slug: 'id',
    permissions: 'permissions',
  },
  [ACTION.ROLE_DELETED]: { roleId: 'id', slug: 'id' },
  [ACTION.SESSION_REVOKED]: {},
  [ACTION.SESSIONS_REVOKED_ALL]: { assignedRoleId: 'id', previousRoleId: 'id' },
  [ACTION.PASSKEYS_RESET]: {},
  [ACTION.ADMIN_RECOVERY_STARTED]: { email: 'text' },
  // feature:invitations:start
  [ACTION.INVITATION_CREATED]: { name: 'text', email: 'text', roleId: 'id' },
  [ACTION.INVITATION_RESENT]: { email: 'text' },
  [ACTION.INVITATION_REVOKED]: {},
  [ACTION.INVITATION_ACCEPTED]: {},
  // feature:invitations:end
};

export const ACTIVITY_PERSONAL_FIELDS: Readonly<
  Record<string, readonly string[]>
> = {
  [ACTION.ACCOUNT_CREATED]: ['name', 'email'],
  [ACTION.ACCOUNT_UPDATED]: ['name', 'email'],
  [ACTION.ADMIN_RECOVERY_STARTED]: ['email'],
  // feature:invitations:start
  [ACTION.INVITATION_CREATED]: ['name', 'email'],
  [ACTION.INVITATION_RESENT]: ['email'],
  // feature:invitations:end
};

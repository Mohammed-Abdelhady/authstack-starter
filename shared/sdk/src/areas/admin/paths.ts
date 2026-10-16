import { pathSegment } from '../user';

const ACCOUNTS_PATH = '/api/admin/users';
const ROLES_PATH = '/api/roles';
const account = (id: string) => `${ACCOUNTS_PATH}/${pathSegment(id, 'Account id')}`;
const permissions = (id: string) => `${account(id)}/permissions`;
const sessions = (id: string) => `${account(id)}/sessions`;

export const ADMIN_PATHS = {
  accounts: ACCOUNTS_PATH,
  account,
  accountStatus: (id: string) => `${account(id)}/status`,
  accountRole: (id: string) => `${account(id)}/role`,
  resendEmailChange: (id: string) => `${account(id)}/resend-email-change`,
  permissions,
  permission: (id: string, permission: string) =>
    `${permissions(id)}/${pathSegment(permission, 'Permission')}`,
  roles: ROLES_PATH,
  role: (idOrSlug: string) => `${ROLES_PATH}/${pathSegment(idOrSlug, 'Role id or slug')}`,
  sessions,
  session: (id: string, sessionId: string) =>
    `${sessions(id)}/${pathSegment(sessionId, 'Session id')}`,
  revokeAllSessions: (id: string) => `${sessions(id)}/revoke-all`,
  activity: '/api/admin/activity',
} as const;

export function withQuery(path: string, query?: object): string {
  const pairs = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return pairs.length === 0 ? path : `${path}?${pairs.join('&')}`;
}

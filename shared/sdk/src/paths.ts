import { AUTH_PATHS } from './areas/auth';
import { OAUTH_PATHS } from './areas/oauth';
import { USER_PATHS } from './areas/user';
import { ADMIN_PATHS } from './areas/admin';
import { ACCOUNT_PATHS } from './areas/account';

/** Every route the client calls, in one place. */
export const API_PATHS = {
  user: USER_PATHS,
  auth: AUTH_PATHS,
  oauth: OAUTH_PATHS,
  admin: ADMIN_PATHS,
  account: ACCOUNT_PATHS,
} as const;

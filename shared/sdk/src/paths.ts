import { AUTH_PATHS } from './areas/auth';
import { OAUTH_PATHS } from './areas/oauth';
import { USER_PATHS } from './areas/user';
import { PROVIDER_PATHS } from './areas/providers';
import { ACCOUNT_DELETION_PATHS } from './areas/account-deletion';

/** Every route the client calls, in one place. */
export const API_PATHS = {
  user: USER_PATHS,
  auth: AUTH_PATHS,
  oauth: OAUTH_PATHS,
  providers: PROVIDER_PATHS,
  accountDeletion: ACCOUNT_DELETION_PATHS,
} as const;

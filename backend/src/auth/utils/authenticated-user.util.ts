import type { AuthenticatedUserSummary } from '../interfaces/authenticated-user.interface';
import { effectivePermissions } from './permissions.util';

export type { AuthenticatedUserSummary };

/** An account as the last step of a sign-in needs it. */
export interface SignInAccount {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  authProvider: string;
  isVerified: boolean;
  twoFactorEnabled: boolean; // feature:totp
}

/**
 * Build the summary of a signed-in account, permissions included.
 *
 * @param account - Account the session belongs to
 * @param rolePermissions - What the account's role grants, null when no role carries its slug
 */
export function toAuthenticatedUser(
  account: SignInAccount,
  rolePermissions: string[] | null,
): AuthenticatedUserSummary {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    authProvider: account.authProvider,
    isVerified: account.isVerified,
    permissions: effectivePermissions(rolePermissions, account.permissions),
  };
}

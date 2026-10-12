/** Account summary every sign-in route returns alongside the session cookie. */
export interface AuthenticatedUserSummary {
  id: string;
  email: string;
  name: string;
  role: string;
  authProvider: string;
  isVerified: boolean;
  permissions: string[];
}

/**
 * Either the sign-in finished and the caller has a session, or a second factor
 * is owed and the challenge cookie is already set.
 */
export type SignInOutcome =
  | { requiresTwoFactor: true }
  | { requiresTwoFactor: false; user: AuthenticatedUserSummary };

import type { OAuthProvider } from '@/modules/oauth'; // feature:oauth-core

// feature:oauth-core:start
/** What the server says an unlink of one listed sign-in method would be told. */
export const UNLINK_HINT = {
  ALLOWED: 'allowed',
  /** The server would refuse: nothing else signs the account in. */
  LAST_SIGN_IN_METHOD: 'last_sign_in_method',
  /** Email sign-in is not a link, so it has no unlink. */
  NOT_REMOVABLE: 'not_removable',
} as const;

export type UnlinkHint = (typeof UNLINK_HINT)[keyof typeof UNLINK_HINT];

/** What the server says choosing one listed sign-in method as primary would be told. */
export const PRIMARY_HINT = {
  ALLOWED: 'allowed',
  /** Email sign-in has no provider profile, so it is never the primary. */
  NO_PROFILE_TO_SYNC: 'no_profile_to_sync',
} as const;

export type PrimaryHint = (typeof PRIMARY_HINT)[keyof typeof PRIMARY_HINT];

/** The entry of `providers` that stands for the address the account was created with. */
export const EMAIL_PROVIDER = 'email';

/** Whether the account's email sign-in can be used on this deployment now. */
export const EMAIL_SIGN_IN = {
  USABLE: 'usable',
  /** Password sign-in and magic links are both off. */
  SWITCHED_OFF: 'switched_off',
} as const;

export type EmailSignInHint = (typeof EMAIL_SIGN_IN)[keyof typeof EMAIL_SIGN_IN];

/**
 * Response type for linked providers endpoint.
 * Providers are 'email' plus the linked OAuth provider ids.
 */
export interface LinkedProvidersResponse {
  providers: string[];
  primaryProvider?: string;
  /** Per entry of `providers`. Absent from a server that predates the hint. */
  unlinkHints?: Record<string, UnlinkHint>;
  /** Per entry of `providers`. Absent from a server that predates the hint. */
  primaryHints?: Record<string, PrimaryHint>;
  /** Sent with an `email` entry. Absent from a server that predates the hint. */
  emailSignIn?: EmailSignInHint;
}
// feature:oauth-core:end

// feature:oauth-core:start
/**
 * Request type for setting primary provider
 */
export interface SetPrimaryProviderRequest {
  provider: OAuthProvider;
}
// feature:oauth-core:end

// feature:oauth-core:start
/**
 * Profile Sync Status Response
 */
export interface ProfileSyncStatus {
  lastSyncedAt?: string;
  lastSyncedProvider?: string;
  primaryProvider?: OAuthProvider;
  canSync: boolean;
}
// feature:oauth-core:end

// feature:oauth-core:start
/**
 * Manual Sync Response
 */
export interface ManualSyncResponse {
  requiresOAuth: boolean;
  provider: OAuthProvider;
  message: string;
}
// feature:oauth-core:end

/**
 * User for account operations
 */
export interface AccountUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

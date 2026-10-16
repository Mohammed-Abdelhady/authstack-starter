/** What accepting the token does. */
export const INVITATION_PURPOSE = {
  /** Creates an account with the invited role. */
  ACCOUNT: 'account',
  /** The first administrator, from `admin:invite`. It has no inviter. */
  FIRST_ADMIN: 'first_admin',
  /** Gives an existing account a 15-minute enrolment session for a new passkey. */
  ENROLMENT: 'enrolment',
} as const;

/** An invitation as the list shows it, derived from its times. */
export const INVITATION_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
} as const;

/** How long an invitation row is kept after it stops being usable: 30 days. */
export const INVITATION_KEEP_AFTER_EXPIRY_MS = 2_592_000_000;

/** Lifetime of an enrolment link from a passkey reset or a recovery: 1 day. */
export const ENROLMENT_LINK_LIFETIME_MS = 86_400_000;

/** Frontend page that reads the token from the fragment and posts it on Accept. */
export const INVITATION_PAGE_PATH = '/auth/invitation';

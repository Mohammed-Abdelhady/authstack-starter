export const SIGN_UP_POLICY = {
  OPEN: 'open',
  CLOSED: 'closed',
} as const;

export const BROWSER_SIGN_IN_METHODS = [
  'password',
  'emailLink',
  'emailCode', // feature:email-code
  'passkeys',
] as const;

// feature:email-code:start
export const EMAIL_CODE_EXPIRES_IN_DEFAULT = 600000;
/** How far past start-up `EMAIL_CODE_REVIEW_UNTIL` may lie: 30 days. */
export const EMAIL_CODE_REVIEW_MAX_AHEAD_MS = 2_592_000_000;
/** A bcrypt hash: `$2a$`, `$2b$` or `$2y$`, a two-digit cost, then salt and hash. */
export const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
// feature:email-code:end
// feature:invitations:start
export const INVITATION_EXPIRES_IN_DEFAULT = 604800000;
// feature:invitations:end
export const ACTIVITY_RETENTION_DAYS_DEFAULT = 730;

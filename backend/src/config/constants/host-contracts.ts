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
// feature:email-code:end
// feature:invitations:start
export const INVITATION_EXPIRES_IN_DEFAULT = 604800000;
// feature:invitations:end
export const ACTIVITY_RETENTION_DAYS_DEFAULT = 730;

export const PROVIDER_REFUSAL = {
  REAUTH: 'REAUTH_REQUIRED',
  ELSEWHERE: 'OAUTH_ACCOUNT_LINKED_ELSEWHERE',
  LINKED: 'PROVIDER_ALREADY_LINKED',
  EXPIRED: 'OAUTH_STATE_INVALID',
  DISABLED: 'FEATURE_DISABLED',
  LAST: 'CANNOT_UNLINK_LAST_PROVIDER',
} as const;
export const PROVIDERS_TEST_ID = {
  SECTION: 'providers-section',
  NOTICE: 'providers-notice',
  ROW: 'provider-row',
  LINK: 'provider-link',
  UNLINK: 'provider-unlink',
  PRIMARY: 'provider-primary',
  RETRY: 'providers-retry',
  SIGN_IN_AGAIN: 'providers-sign-in-again',
} as const;
export const PROVIDER_EMAIL_ID = 'email';

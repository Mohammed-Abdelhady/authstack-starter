export const CREDENTIAL_PURPOSE = {
  BROWSER_SESSION: 'browser_session',
  ENROLMENT: 'enrolment',
  NATIVE_ACCESS: 'native_access',
  NATIVE_REFRESH: 'native_refresh',
  AUTHORIZATION_CODE: 'authorization_code',
  PENDING_AUTHENTICATION: 'pending_authentication',
} as const;

export type CredentialPurpose =
  (typeof CREDENTIAL_PURPOSE)[keyof typeof CREDENTIAL_PURPOSE];

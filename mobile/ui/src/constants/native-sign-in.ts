export const NATIVE_METHOD = {
  PASSWORD: 'password',
  EMAIL_LINK: 'emailLink',
  EMAIL_CODE: 'emailCode', // feature:email-code
  REGISTRATION: 'registration',
  RECOVERY: 'recovery',
} as const;
export const NATIVE_DISCOVERY = { LOADING: 'loading', READY: 'ready', FAILED: 'failed' } as const;
export const NATIVE_UI_TEST_ID = {
  PASSWORD_CHOICE: 'native-password-choice',
  EMAIL_LINK_CHOICE: 'native-email-link-choice',
  EMAIL_CODE_CHOICE: 'native-email-code-choice', // feature:email-code
  REGISTRATION_CHOICE: 'native-registration-choice',
  RECOVERY_CHOICE: 'native-recovery-choice',
  PASSKEY_CHOICE: 'native-passkey-choice',
  METHODS_RETRY: 'native-methods-retry',
  METHODS_NOTICE: 'native-methods-notice',
  NOTICE: 'native-notice',
  EMAIL: 'native-email',
  PASSWORD: 'native-password',
  PASSWORD_VISIBILITY: 'native-password-visibility',
  NAME: 'native-name',
  CODE: 'native-code',
  SUBMIT: 'native-submit',
  CANCEL: 'native-cancel',
  WEB: 'native-web',
  RESEND: 'native-resend',
  TOTP: 'native-totp-choice',
  RECOVERY_CODE: 'native-recovery-code-choice',
  CONSENT: 'native-consent',
  CONSENT_ACCEPT: 'native-consent-accept',
} as const;

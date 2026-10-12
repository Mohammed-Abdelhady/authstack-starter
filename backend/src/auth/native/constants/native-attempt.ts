export const NATIVE_ATTEMPT_PHASE = {
  FIRST_FACTOR_REQUIRED: 'firstFactorRequired',
  EMAIL_LINK_SENT: 'emailLinkSent',
  REGISTRATION_CODE_REQUIRED: 'registrationCodeRequired',
  RECOVERY_CODE_REQUIRED: 'recoveryCodeRequired',
  SECOND_FACTOR_REQUIRED: 'secondFactorRequired',
  CONSENT_REQUIRED: 'consentRequired',
  CODE_READY: 'codeReady',
  DENIED: 'denied',
  RECOVERY_COMPLETE: 'recoveryComplete',
} as const;

export const NATIVE_ATTEMPT_HEADER = 'X-Native-Attempt';

export const NATIVE_ATTEMPT_FLOW = {
  SIGN_IN: 'signIn',
  REGISTRATION: 'registration',
  RECOVERY: 'recovery',
} as const;

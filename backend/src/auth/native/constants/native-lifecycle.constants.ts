export const NATIVE_EMAIL_CALLBACK_PARAM = {
  ATTEMPT_ID: 'native_attempt_id',
  EMAIL_TOKEN: 'native_email_token',
  STATE: 'state',
} as const;

export const NATIVE_LIFECYCLE_LIMITS = {
  EMAIL: 255,
  EMAIL_TOKEN: 4096,
  STATE: 512,
} as const;

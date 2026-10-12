export const NATIVE_BROWSER_SELECTOR_QUERY = {
  PROVIDER_ID: 'provider_id',
  FLOW: 'flow',
  LOCALE: 'locale',
} as const;

export const NATIVE_BROWSER_FLOW = {
  SIGN_IN: 'signIn',
  REGISTRATION: 'registration',
  RECOVERY: 'recovery',
} as const;

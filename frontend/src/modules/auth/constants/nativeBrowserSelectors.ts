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

export const NATIVE_BROWSER_AVAILABLE_FLOWS: readonly string[] = [
  NATIVE_BROWSER_FLOW.SIGN_IN,
  NATIVE_BROWSER_FLOW.REGISTRATION, // feature:email-password
  NATIVE_BROWSER_FLOW.RECOVERY, // feature:email-password
];

export const NATIVE_BROWSER_PROVIDER_PATTERNS: readonly RegExp[] = [
  /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, // feature:oauth-core
];

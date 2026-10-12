export const NATIVE_SIGN_IN_LOCALE = {
  EN: 'en',
  AR: 'ar', // feature:locale-ar
} as const;

export type NativeSignInLocale = (typeof NATIVE_SIGN_IN_LOCALE)[keyof typeof NATIVE_SIGN_IN_LOCALE];

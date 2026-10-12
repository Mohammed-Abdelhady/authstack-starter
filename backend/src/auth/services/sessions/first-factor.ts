/**
 * What the first step of a sign-in proved. The route that took it says so
 * when it finishes the sign-in, and a sign-in held for a second factor keeps
 * it for the second step.
 */
export const FIRST_FACTOR = {
  PASSWORD: 'password',
  MAGIC_LINK: 'magic_link',
  /** The code mailed to a new account's address. */
  EMAIL_CODE: 'email_code',
  PROVIDER: 'provider',
  /** A passkey that did not verify its user: the key and nothing else. */
  PASSKEY: 'passkey',
} as const;

export type FirstFactor = (typeof FIRST_FACTOR)[keyof typeof FIRST_FACTOR];

/** For a value that came from outside, such as a cookie. */
export function isFirstFactor(value: unknown): value is FirstFactor {
  return Object.values<unknown>(FIRST_FACTOR).includes(value);
}

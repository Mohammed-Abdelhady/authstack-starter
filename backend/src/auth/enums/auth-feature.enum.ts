/**
 * Authentication features a deployment can turn on or off. The values double
 * as the keys of the discovery endpoint payload.
 */
export enum AuthFeature {
  /** Register, login, forgot password and reset password. */
  PASSWORD = 'password',
  EMAIL_CODE = 'emailCode',
  /** One-time sign-in links mailed to an address. */
  MAGIC_LINK = 'magicLink',
  /** TOTP second factor, on top of whichever method signed the user in. */
  TWO_FACTOR = 'twoFactor',
  /** WebAuthn credentials, used to sign in and as a second factor. */
  PASSKEYS = 'passkeys',
}

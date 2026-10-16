/** How `engine.passkeys.register()` ended. */
export const PASSKEY_REGISTER_OUTCOME = {
  CREATED: 'created',
  CANCELLED: 'cancelled',
  NOT_SUPPORTED: 'notSupported',
  /** The sign-in is too old to add a passkey; sign in again, then retry. */
  SIGN_IN_AGAIN: 'signInAgain',
  /** The authenticator already holds one of the account's passkeys. */
  ALREADY_REGISTERED: 'alreadyRegistered',
  FAILED: 'failed',
} as const;

/** The server code that asks for a fresh sign-in before a passkey is added. */
export const PASSKEY_REAUTH_CODE = 'REAUTH_REQUIRED';

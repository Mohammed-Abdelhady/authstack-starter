export const PASSKEYS_TEST_ID = {
  SECTION: 'passkeys-section',
  ADD: 'passkeys-add',
  RETRY: 'passkeys-retry',
  NOTICE: 'passkeys-notice',
  SIGN_IN_AGAIN: 'passkeys-sign-in-again',
  ROW: 'passkeys-row',
  RENAME: 'passkeys-rename',
  NAME_FIELD: 'passkeys-name-field',
  SAVE_NAME: 'passkeys-save-name',
  CANCEL_RENAME: 'passkeys-cancel-rename',
  REMOVE: 'passkeys-remove',
} as const;

export const PASSKEYS_VIEW = {
  LOADING: 'loading',
  ERROR: 'error',
  EMPTY: 'empty',
  READY: 'ready',
} as const;

export type PasskeysView = (typeof PASSKEYS_VIEW)[keyof typeof PASSKEYS_VIEW];

/** The longest name the server stores. */
export const PASSKEY_NAME_MAX_LENGTH = 64;

/** The server's answer when a removal would leave the account no way in. */
export const PASSKEY_LAST_WAY_IN_CODE = 'PASSKEY_LAST_SIGN_IN_METHOD';

export const PASSKEY_REQUIRED_LAST_CODE = 'PASSKEY_REQUIRED_LAST';

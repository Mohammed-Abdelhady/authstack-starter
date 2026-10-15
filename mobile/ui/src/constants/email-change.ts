/** Where the person is in changing their address. */
export const EMAIL_STEP = {
  /** Shows the address, with the way to change it. */
  IDLE: 'idle',
  /** Typing the new address. */
  EDITING: 'editing',
  /** A code was asked for; typing it, or giving up. */
  AWAITING_CODE: 'awaitingCode',
} as const;
export type EmailStep = (typeof EMAIL_STEP)[keyof typeof EMAIL_STEP];

/** What the last answer means for the person, one notice each. */
export const EMAIL_OUTCOME = {
  SENT: 'sent',
  CHANGED: 'changed',
  CANCELLED: 'cancelled',
  SIGN_IN_AGAIN: 'signInAgain',
  INVALID_ADDRESS: 'invalidAddress',
  LIMIT_REACHED: 'limitReached',
  CODE_REFUSED: 'codeRefused',
  OFFLINE: 'offline',
  FAILED: 'failed',
} as const;
export type EmailOutcome = (typeof EMAIL_OUTCOME)[keyof typeof EMAIL_OUTCOME];

/** The digits a mailed code has. */
export const EMAIL_CODE_LENGTH = 6;

export const EMAIL_TEST_ID = {
  SECTION: 'email-section',
  START: 'email-change-start',
  ADDRESS: 'email-change-address',
  SEND: 'email-change-send',
  CODE: 'email-change-code',
  CONFIRM: 'email-change-confirm',
  CANCEL: 'email-change-cancel',
  RETRY: 'email-change-retry',
  NOTICE: 'email-change-notice',
} as const;

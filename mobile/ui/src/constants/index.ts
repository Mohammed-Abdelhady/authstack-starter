export const SIGN_IN_STATE = {
  RESTORING: 'restoring',
  IDLE: 'idle',
  IN_PROGRESS: 'inProgress',
  BROWSER_CLOSED: 'browserClosed',
  FAILED: 'failed',
  STORAGE_LOCKED: 'storageLocked',
  OFFLINE: 'offline',
} as const;
export type SignInState = (typeof SIGN_IN_STATE)[keyof typeof SIGN_IN_STATE];

/** What the primary button does in a given sign-in state. */
export const SIGN_IN_ACTION = { SIGN_IN: 'signIn', RESTORE: 'restore' } as const;
export type SignInAction = (typeof SIGN_IN_ACTION)[keyof typeof SIGN_IN_ACTION];

export const SIGN_IN_FAILURE = {
  EXPIRED: 'expired',
  DENIED: 'denied',
  DISABLED: 'disabled',
  THROTTLED: 'throttled',
  DEVICE_KEY: 'deviceKey',
  BROWSER: 'browser',
  STORAGE: 'storage',
  GENERIC: 'generic',
} as const;
export type SignInFailure = (typeof SIGN_IN_FAILURE)[keyof typeof SIGN_IN_FAILURE];

export const ROOT_VIEW = { SIGN_IN: 'signIn', SIGNED_IN: 'signedIn' } as const;
export type RootView = (typeof ROOT_VIEW)[keyof typeof ROOT_VIEW];

export const ROUTE = { ACCOUNT: 'account', SESSIONS: 'sessions' } as const;
export type Route = (typeof ROUTE)[keyof typeof ROUTE];

export const API_FAILURE = {
  OFFLINE: 'offline',
  SIGNED_OUT: 'signedOut',
  REFUSED: 'refused',
  UNKNOWN: 'unknown',
} as const;
export type ApiFailureKind = (typeof API_FAILURE)[keyof typeof API_FAILURE];

export const LIST_VIEW = {
  LOADING: 'loading',
  ERROR: 'error',
  EMPTY: 'empty',
  READY: 'ready',
} as const;
export type ListView = (typeof LIST_VIEW)[keyof typeof LIST_VIEW];

export const REVOKE_RESULT = {
  REVOKED: 'revoked',
  SIGNED_OUT: 'signedOut',
  UNDONE: 'undone',
  SUPERSEDED: 'superseded',
  CANCELLED: 'cancelled',
  BUSY: 'busy',
} as const;
export type RevokeResult = (typeof REVOKE_RESULT)[keyof typeof REVOKE_RESULT];

export const SESSION_KIND = { BROWSER: 'browser', NATIVE_APP: 'nativeApp' } as const;
export type SessionKind = (typeof SESSION_KIND)[keyof typeof SESSION_KIND];

export const ACTIVITY = { NOW: 'now', TODAY: 'today', EARLIER: 'earlier' } as const;
export type Activity = (typeof ACTIVITY)[keyof typeof ACTIVITY];

/** A session used this recently reads as active now. */
export const ACTIVE_NOW_WINDOW_MS = 5 * 60 * 1000;

export const API_TAG = { PROFILE: 'Profile', SESSIONS: 'Sessions' } as const;
export const API_REDUCER_PATH = 'nativeUiApi';

export const ROLE_SLUG = {
  USER: 'user',
  SUPPORT: 'support',
  MANAGER: 'manager',
  ADMIN: 'admin',
} as const;

export const TEST_ID = {
  SIGN_IN_SCREEN: 'sign-in-screen',
  SIGN_IN_ACTION: 'sign-in-action',
  SIGN_IN_NOTICE: 'sign-in-notice',
  ACCOUNT_SCREEN: 'account-screen',
  ACCOUNT_RETRY: 'account-retry',
  ACCOUNT_SESSIONS_LINK: 'account-sessions-link',
  ACCOUNT_SIGN_OUT: 'account-sign-out',
  SESSIONS_SCREEN: 'sessions-screen',
  SESSIONS_LIST: 'sessions-list',
  SESSIONS_BACK: 'sessions-back',
  SESSIONS_RETRY: 'sessions-retry',
  SESSIONS_REVOKE_OTHERS: 'sessions-revoke-others',
  SESSIONS_NOTICE: 'sessions-notice',
  SESSION_ROW: 'session-row',
  SESSION_REVOKE: 'session-revoke',
} as const;

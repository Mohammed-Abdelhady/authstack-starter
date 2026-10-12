import type { Session } from '@app/sdk';

/** What a row calls its session. Each value is also its key under `sessions.kind`. */
export const SESSION_KIND = {
  BROWSER: 'browser',
  NATIVE_APP: 'nativeApp',
} as const;

export type SessionKind = (typeof SESSION_KIND)[keyof typeof SESSION_KIND];

export const SESSION_KIND_BY_PURPOSE: Record<Session['credentialPurpose'], SessionKind> = {
  browser_session: SESSION_KIND.BROWSER,
  native_access: SESSION_KIND.NATIVE_APP,
};

/** What `parseUserAgent` returns for a system it cannot name. */
export const UNKNOWN_OS_LABELS: readonly string[] = ['Unknown OS', 'Unknown'];
export const UNKNOWN_BROWSER_LABELS: readonly string[] = ['Unknown Browser', 'Unknown'];

import type { SecurityNotice } from '../types/security-notice.type';

export const SECURITY_NOTICE = {
  PASSWORD_RESET: 'password_reset',
  PASSWORD_CHANGED: 'password_changed',
  TWO_FACTOR_DISABLED: 'two_factor_disabled',
  PASSKEY_ADDED: 'passkey_added',
  PROVIDER_ADDED: 'provider_added',
  PASSKEY_REMOVED: 'passkey_removed',
  EMAIL_CHANGE_REQUESTED: 'email_change_requested',
  EMAIL_CHANGED: 'email_changed',
  NEW_DEVICE: 'new_device',
  ACCOUNT_DEACTIVATED: 'account_deactivated',
  ACCOUNT_RESTORED: 'account_restored',
  PASSKEYS_RESET: 'passkeys_reset',
} as const;

/**
 * Notices about something staff did. The device that made the change is the
 * staff member's, so these name the time only.
 */
export const STAFF_SECURITY_NOTICES: ReadonlySet<SecurityNotice> = new Set([
  SECURITY_NOTICE.ACCOUNT_DEACTIVATED,
  SECURITY_NOTICE.ACCOUNT_RESTORED,
  SECURITY_NOTICE.PASSKEYS_RESET,
]);

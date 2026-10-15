export const REVOKED_REASON = {
  EXPIRED: 'expired',
  CURRENT: 'current_logout',
  EMAIL_CHANGED: 'email_changed',
  SELECTED: 'selected_revoke',
  ALL_USER: 'all_user',
  ALL_OTHER: 'all_other',
  GRANT_BLOCKED: 'grant_blocked',
  APPLICATION_DISABLED: 'application_disabled',
  ADMIN_FORCED: 'admin_forced',
  ENROLMENT_PROMOTED: 'enrolment_promoted',
  ENROLMENT_REPLACED: 'enrolment_replaced',
} as const;

export type RevokedReason =
  (typeof REVOKED_REASON)[keyof typeof REVOKED_REASON];

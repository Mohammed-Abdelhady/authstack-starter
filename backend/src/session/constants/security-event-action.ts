export const SECURITY_EVENT_ACTION = {
  AUDIENCE_REFUSED: 'audience_refused',
  SIGN_UP_REFUSED: 'sign_up_refused',
  PASSKEY_REQUIRED: 'passkey_required',
  POLICY_CHANGED: 'policy_changed',
  ACCOUNT_CREATED: 'account_created',
  ACCOUNT_UPDATED: 'account_updated',
  ACCOUNT_STATUS_CHANGED: 'account_status_changed',
  ACCOUNT_DELETED: 'account_deleted',
  PERMISSION_GRANTED: 'permission_granted',
  PERMISSION_REVOKED: 'permission_revoked',
  ROLE_CREATED: 'role_created',
  ROLE_UPDATED: 'role_updated',
  PASSKEYS_RESET: 'passkeys_reset',
  ADMIN_RECOVERY_STARTED: 'admin_recovery_started',
  // feature:email-code:start
  EMAIL_CODE_REVIEW_SIGNED_IN: 'email_code_review_signed_in',
  EMAIL_CODE_REVIEW_LOCKED: 'email_code_review_locked',
  // feature:email-code:end
  // feature:invitations:start
  INVITATION_CREATED: 'invitation_created',
  INVITATION_RESENT: 'invitation_resent',
  INVITATION_REVOKED: 'invitation_revoked',
  INVITATION_ACCEPTED: 'invitation_accepted',
  // feature:invitations:end
  ROLE_DELETED: 'role_deleted',
  SESSION_ISSUED: 'session_issued',
  SESSION_REVOKED: 'session_revoked',
  SESSIONS_REVOKED_ALL: 'sessions_revoked_all',
  SESSIONS_REVOKED_OTHERS: 'sessions_revoked_others',
  GRANT_BLOCKED: 'grant_blocked',
  APPLICATION_DISABLED: 'application_disabled',
  APPLICATION_ENABLED: 'application_enabled',
  REFRESH_REPLAYED: 'refresh_replayed',
  NATIVE_CLIENT_REVOKED: 'native_client_revoked',
  NATIVE_DPOP_PROOF_REFUSED: 'native_dpop_proof_refused',
  NATIVE_DPOP_BOUND_RETRY: 'native_dpop_bound_retry',
} as const;

export const SECURITY_EVENT_OUTCOME = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const;

export const ROLE_DELETION_EVENT_PREFIX = 'role-deletion:';

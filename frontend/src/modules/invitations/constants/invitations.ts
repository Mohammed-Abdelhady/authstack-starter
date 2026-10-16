export const INVITATIONS_PATH = '/api/admin/invitations';
export const INVITATION_ACCEPT_PATH = '/api/auth/invitations/accept';
export const FRESH_PROOF_PATH = '/api/auth/proof';
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const INVITATION_PAGE_LIMIT = 20;
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export const PROOF_CODE_LENGTH = 6;
export const PROOF_CODE_PATTERN = /^[0-9]{6}$/;
export const INVITATION_DESTINATIONS = { dashboard: '/dashboard', enrolment: '/settings' } as const;

export const INVITATION_ERROR_KEYS = {
  EMAIL_ALREADY_EXISTS: 'emailExists',
  ROLE_NOT_FOUND: 'roleMissing',
  CANNOT_MODIFY_HIGHER_ROLE: 'higherRole',
  INVALID_ROLE_ASSIGNMENT: 'invalidRole',
  VALIDATION_ERROR: 'validation',
  REAUTH_REQUIRED: 'reauth',
  INVITATION_INVALID: 'invalidLink',
  EMAIL_CODE_INVALID: 'invalidCode',
  PASSKEY_VERIFICATION_FAILED: 'passkeyFailed',
} as const;

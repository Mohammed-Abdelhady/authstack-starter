export const INVITATIONS_PATH = '/api/admin/invitations';
export const INVITATION_ACCEPT_PATH = '/api/auth/invitations/accept';
export const INVITATION_CONFLICT_STATUS = 409;
export const INVITATION_PAGE_LIMIT = 20;
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export const INVITATION_DESTINATIONS = {
  dashboard: '/dashboard',
  enrolment: '/auth/invitation/enrolment',
} as const;

export const INVITATION_ERROR_KEYS = {
  EMAIL_ALREADY_EXISTS: 'emailExists',
  ROLE_NOT_FOUND: 'roleMissing',
  CANNOT_MODIFY_HIGHER_ROLE: 'higherRole',
  INVALID_ROLE_ASSIGNMENT: 'invalidRole',
  VALIDATION_ERROR: 'validation',
  REAUTH_REQUIRED: 'reauth',
  INVITATION_INVALID: 'invalidLink',
  ACTIVATION_CODE_INVALID: 'invalidCode',
  PASSKEY_VERIFICATION_FAILED: 'passkeyFailed',
} as const;

export {
  FRESH_PROOF_PATH,
  IDEMPOTENCY_HEADER,
  PROOF_CODE_LENGTH,
  PROOF_CODE_PATTERN,
  PROOF_ACTION,
} from '@/modules/auth/constants/staff-operation';

/** Staff creates that take an idempotency key. A key belongs to one of these. */
export const STAFF_OPERATION = {
  ACCOUNT_CREATE: 'account.create',
  ROLE_CREATE: 'role.create',
  INVITATION_CREATE: 'invitation.create', // feature:invitations
} as const;

export const IDEMPOTENCY_CLAIM = {
  CLAIMED: 'claimed',
  EXISTING: 'existing',
} as const;

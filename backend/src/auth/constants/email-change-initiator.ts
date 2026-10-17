export const EMAIL_CHANGE_INITIATOR = { SELF: 'self', STAFF: 'staff' } as const;
export type EmailChangeInitiator =
  (typeof EMAIL_CHANGE_INITIATOR)[keyof typeof EMAIL_CHANGE_INITIATOR];

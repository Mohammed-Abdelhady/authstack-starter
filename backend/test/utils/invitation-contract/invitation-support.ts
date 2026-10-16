import {
  INVITATION_KEEP_AFTER_EXPIRY_MS,
  INVITATION_PURPOSE,
} from '../../../src/auth/invitations/constants/invitations';
import type {
  NewInvitation,
  StoredInvitation,
} from '../../../src/auth/invitations/types/invitation';
import type { InvitationHarness } from './invitation-harness';

export const LIFETIME_MS = 60_000;
export const EMAIL = 'invitee@example.test';
export function invitationInput(
  h: InvitationHarness,
  patch: Partial<NewInvitation> = {},
): NewInvitation {
  const now = h.clock.now();
  const expiresAt = new Date(now.getTime() + LIFETIME_MS);
  const enrolment = patch.purpose === INVITATION_PURPOSE.ENROLMENT;
  return {
    ...(enrolment ? { addressGeneration: 0 } : {}),
    purpose: INVITATION_PURPOSE.ACCOUNT,
    email: EMAIL,
    roleId: 'role-id',
    roleSlug: 'user',
    clientId: 'web',
    locale: 'en',
    tokenHash: 'original-hash',
    expiresAt,
    purgeAfter: new Date(expiresAt.getTime() + INVITATION_KEEP_AFTER_EXPIRY_MS),
    now,
    ...patch,
  };
}

export function insert(
  h: InvitationHarness,
  patch: Partial<NewInvitation> = {},
): Promise<StoredInvitation> {
  return h
    .runner()
    .run((work) => h.store.insert(work, invitationInput(h, patch)));
}

import type { InvitationPurpose } from '../../auth/invitations/types/invitation';
import { INVITATION_PAGE_PATH } from '../../auth/invitations/constants/invitations';

export function invitationLink(
  origin: string,
  token: string,
  purpose: InvitationPurpose,
): string {
  const link = new URL(INVITATION_PAGE_PATH, new URL(origin).origin);
  link.hash = new URLSearchParams({ token, purpose }).toString();
  return link.toString();
}

import type { InvitationPurpose } from '../../auth/invitations/types/invitation';

export function invitationLink(
  origin: string,
  token: string,
  purpose: InvitationPurpose,
): string {
  const link = new URL(origin);
  link.hash = new URLSearchParams({ token, purpose }).toString();
  return link.toString();
}

import { INVITATION_STATUS } from '../../auth/invitations/constants/invitations';
import type { StoredInvitation } from '../../auth/invitations/types/invitation';
import type { AdminInvitationDto } from './dto/admin-invitation.dto';

export function mapAdminInvitation(
  invitation: StoredInvitation,
  now: Date,
): AdminInvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    name: invitation.name,
    role: invitation.roleSlug ?? '',
    audience: invitation.audience,
    status: invitation.acceptedAt
      ? INVITATION_STATUS.ACCEPTED
      : invitation.revokedAt
        ? INVITATION_STATUS.REVOKED
        : invitation.expiresAt.getTime() <= now.getTime()
          ? INVITATION_STATUS.EXPIRED
          : INVITATION_STATUS.PENDING,
    invitedBy: invitation.invitedBy,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
    createdAt: invitation.createdAt,
  };
}

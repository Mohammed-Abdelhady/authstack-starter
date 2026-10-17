// feature:invitations:start
import type { RoleAudience } from '@app/core';
import type { INVITATION_PURPOSES, INVITATION_STATUSES } from '../invitations/constants';

export type InvitationPurpose = (typeof INVITATION_PURPOSES)[number];
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export interface AdminInvitation {
  id: string;
  email: string;
  name?: string;
  role: string;
  audience?: RoleAudience;
  status: InvitationStatus;
  invitedBy?: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface AdminInvitationPage {
  invitations: AdminInvitation[];
  total: number;
  page: number;
  pages: number;
}

export interface AdminInvitationQuery {
  status?: InvitationStatus;
  page?: number;
  limit?: number;
}

export interface CreateAdminInvitationRequest {
  /** Required together for a new strict write. Reuse the same body for replay. */
  expectedRoleId?: string;
  /** Null explicitly observes an absent role audience; omission remains distinct. */
  expectedAudience?: RoleAudience | null;
  email: string;
  role: string;
  name?: string;
  locale?: string;
}

export interface InvitationAcceptance {
  purpose: InvitationPurpose;
  enrolment: boolean;
  user: { id: string; email: string; name: string; role: string };
}
// feature:invitations:end

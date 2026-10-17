import type { SupportedLocale } from '../../../common/constants/locales';
import type { RoleAudience } from '../../../host/types/host-role.type';
import type {
  INVITATION_PURPOSE,
  INVITATION_STATUS,
} from '../constants/invitations';

export type InvitationPurpose =
  (typeof INVITATION_PURPOSE)[keyof typeof INVITATION_PURPOSE];

export type InvitationStatus =
  (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS];

/** An invitation or enrolment link as a store read it. The token is never stored. */
export interface StoredInvitation {
  readonly id: string;
  readonly purpose: InvitationPurpose;
  /** Normalised address the mail went to. */
  readonly email: string;
  readonly name?: string;
  /** The role as it was when the invitation was made. Absent for enrolment links. */
  readonly roleId?: string;
  readonly roleSlug?: string;
  readonly audience?: RoleAudience;
  /** The application acceptance signs the account in to. */
  readonly clientId: string;
  /** Absent for the first administrator's invitation. */
  readonly invitedBy?: string;
  /** The account an enrolment link belongs to. */
  readonly userId?: string;
  /** The account's address generation the enrolment link was mailed for. */
  readonly addressGeneration?: number;
  readonly locale: SupportedLocale;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly acceptedAt?: Date;
  readonly revokedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewInvitation {
  readonly purpose: InvitationPurpose;
  readonly email: string;
  readonly name?: string;
  readonly roleId?: string;
  readonly roleSlug?: string;
  readonly audience?: RoleAudience;
  readonly clientId: string;
  readonly invitedBy?: string;
  readonly userId?: string;
  readonly addressGeneration?: number;
  readonly locale: SupportedLocale;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly purgeAfter: Date;
  readonly now: Date;
}

export interface InvitationTokenChange {
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly purgeAfter: Date;
  readonly now: Date;
}

export interface InvitationListQuery {
  /** Audiences the actor may see. Absent means every one. */
  readonly audiences?: readonly RoleAudience[];
  readonly status?: InvitationStatus;
  readonly page: number;
  readonly limit: number;
  readonly now: Date;
}

export interface InvitationPage {
  readonly invitations: StoredInvitation[];
  readonly total: number;
}

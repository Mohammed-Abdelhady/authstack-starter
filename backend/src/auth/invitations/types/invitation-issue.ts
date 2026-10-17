import type { SupportedLocale } from '../../../common/constants/locales';
import type { RoleAudience } from '../../../host/types/host-role.type';
import type { InvitationPurpose, StoredInvitation } from './invitation';

export interface InvitationIssueInput {
  purpose: InvitationPurpose;
  email: string;
  name?: string;
  role?: { id: string; slug: string; audience?: RoleAudience };
  invitedBy?: string;
  userId?: string;
  audience?: RoleAudience;
  /** Required for an enrolment link: the account's current address generation. */
  addressGeneration?: number;
  locale: SupportedLocale;
  clientId: string;
  lifetimeMs: number;
}

export interface IssuedInvitation {
  invitation: StoredInvitation;
  token: string;
}

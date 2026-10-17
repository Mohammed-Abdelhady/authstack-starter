import type { InvitationPurpose } from './invitation';

export interface InvitationAcceptance {
  purpose: InvitationPurpose;
  enrolment: boolean;
  user: { id: string; email: string; name: string; role: string };
}

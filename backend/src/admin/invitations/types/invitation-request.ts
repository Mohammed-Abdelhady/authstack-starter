import type { ActingSession } from '../../../auth/proof/types/acting-session';

export interface InvitationActor {
  id: string;
  role: string;
  permissions?: readonly string[];
  session?: ActingSession;
}

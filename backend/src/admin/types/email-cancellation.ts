import type { ActingSession } from '../../auth/proof/types/acting-session';

export interface EmailCancellation {
  id: string;
  actorId: string;
  actorRole: string;
  actorPermissions?: readonly string[];
  session: ActingSession;
  version?: number;
}

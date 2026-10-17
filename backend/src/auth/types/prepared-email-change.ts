import type { EmailChangePurpose } from '../constants/registration';
import { PendingCodeGeneration } from '../pending-codes/pending-registration.store';

export interface EmailChangeCodeTarget {
  userId: string;
  addressGeneration: number;
}

export interface BoundEmailChangeGeneration extends PendingCodeGeneration {
  userId: string;
  addressGeneration: number;
}

export interface PreparedEmailChange {
  email: string;
  code: string;
  generation: BoundEmailChangeGeneration;
  /** Who asked for the change, which decides the route that may confirm it. */
  purpose: EmailChangePurpose;
}

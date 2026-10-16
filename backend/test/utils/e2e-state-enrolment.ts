// feature:passkeys:start
import type { UnitOfWork } from '../../src/common/persistence/unit-of-work';

/** What the passkey enrolment cases arrange and read. */
export interface E2eEnrolmentState {
  /** Simulates only the credential write normally owned by passkey registration. */
  insertIn(
    work: UnitOfWork,
    userId: string,
    credentialId: string,
    at: Date,
  ): Promise<void>;
  count(userId: string): Promise<number>;
  revocationReason(sessionId: string): Promise<string | null>;
  audienceRefusals(
    userId: string,
  ): Promise<{ clientId: string | null; outcome: string }[]>;
}
// feature:passkeys:end

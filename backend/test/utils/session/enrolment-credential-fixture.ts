// feature:passkeys:start
import type { INestApplication } from '@nestjs/common';
import { forStorage } from '../../../src/common/persistence/storage-choice';
import type { UnitOfWork } from '../../../src/common/persistence/unit-of-work';

export interface EnrolmentCredentialFixture {
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

/** Simulates only the credential write normally owned by passkey registration. */
export function enrolmentCredentialFixture(
  app: INestApplication,
): Promise<EnrolmentCredentialFixture> {
  return forStorage<Promise<EnrolmentCredentialFixture>>({
    // feature:postgres:start
    postgres: async () => {
      const { postgresEnrolmentCredentials } =
        await import('../../postgres/postgres-enrolment-credentials');
      return postgresEnrolmentCredentials(app);
    },
    // feature:postgres:end
    // feature:mongodb:start
    mongodb: async () => {
      const { mongoEnrolmentCredentials } =
        await import('./mongo-enrolment-credentials');
      return mongoEnrolmentCredentials(app);
    },
    // feature:mongodb:end
  });
}
// feature:passkeys:end

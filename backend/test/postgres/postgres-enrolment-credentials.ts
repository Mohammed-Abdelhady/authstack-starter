// feature:passkeys:start
import type { INestApplication } from '@nestjs/common';
import {
  POSTGRES_DATABASE,
  type PostgresDatabase,
} from '../../src/common/persistence/postgres/postgres-connection';
import { postgresTransactionOf } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import type { EnrolmentCredentialFixture } from '../utils/session/enrolment-credential-fixture';

export function postgresEnrolmentCredentials(
  app: INestApplication,
): EnrolmentCredentialFixture {
  const database = app.get<PostgresDatabase>(POSTGRES_DATABASE);
  return {
    insertIn: async (work, userId, credentialId, at) => {
      await postgresTransactionOf(work)
        .insertInto('passkeys')
        .values({
          user_id: userId,
          credential_id: credentialId,
          public_key: Buffer.from([0, 255, 1, 128]),
          counter: 0,
          transports: ['internal'],
          device_type: null,
          backed_up: false,
          name: 'Enrolment transaction credential',
          last_used_at: null,
          created_at: at,
          updated_at: at,
        })
        .execute();
    },
    count: async (userId) => {
      const row = await database
        .selectFrom('passkeys')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
      return Number(row.count);
    },
    revocationReason: async (sessionId) => {
      const row = await database
        .selectFrom('sessions')
        .select('revoked_reason')
        .where('id', '=', sessionId)
        .executeTakeFirst();
      return row?.revoked_reason ?? null;
    },
    audienceRefusals: async (userId) => {
      const rows = await database
        .selectFrom('security_events')
        .select(['client_id', 'outcome'])
        .where('target_user_id', '=', userId)
        .where('action', '=', 'audience_refused')
        .execute();
      return rows.map(({ client_id, outcome }) => ({
        clientId: client_id,
        outcome,
      }));
    },
  };
}
// feature:passkeys:end

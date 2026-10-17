import { randomUUID } from 'node:crypto';
import { PostgresSessionProofStore } from '../../src/auth/proof/persistence/postgres/postgres-session-proof.store';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import { SessionProofHarness } from '../utils/session-proof-contract/session-proof-harness';
import { openTestConnection } from './postgres-connection';

const CLIENT_ID = 'staff-console';
const EXPIRES_AT = new Date('2099-01-02T12:00:00.000Z');

export async function bootPostgresSessionProofHarness(): Promise<SessionProofHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  return {
    store: new PostgresSessionProofStore(),
    clock: new FrozenClock(TEST_NOW),
    runner: () => new PostgresUnitOfWorkRunner(database),
    seedSession: async (existingUserId) => {
      let userId = existingUserId;
      if (userId === undefined) {
        const user = await database
          .insertInto('users')
          .values({ email: `${randomUUID()}@example.com` })
          .returning('id')
          .executeTakeFirstOrThrow();
        userId = user.id;
      }
      const row = await database
        .insertInto('sessions')
        .values({
          user_id: userId,
          token_hash: Buffer.from(randomUUID()),
          user_agent: 'Contract/1',
          device: null,
          ip: '127.0.0.1',
          client_id: CLIENT_ID,
          user_version: 0,
          client_version: 0,
          grant_version: 0,
          auth_epoch: 1,
          schema_version: 1,
          scopes: ['api'],
          audience: 'api',
          authentication_methods: [],
          credential_purpose: 'browser_session',
          browser_generation: 1,
          authenticated_at: TEST_NOW,
          last_used_at: TEST_NOW,
          last_activity_at: TEST_NOW,
          expires_at: EXPIRES_AT,
          idle_expires_at: EXPIRES_AT,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { userId, sessionId: row.id, clientId: CLIENT_ID };
    },
    purgeAfter: async (ref) => {
      const row = await database
        .selectFrom('session_proofs')
        .select('purge_after')
        .where('session_id', '=', ref.sessionId)
        .where('user_id', '=', ref.userId)
        .where('client_id', '=', ref.clientId)
        .executeTakeFirst();
      return row?.purge_after ?? null;
    },
    reset: async () => {
      await connection.rollBackOpenWork();
      await database.deleteFrom('session_proofs').execute();
      await connection.reset();
    },
    close: connection.close,
  };
}

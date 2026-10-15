import { browserApplicationsForTest } from '../../src/common/testing/browser-applications.harness-spec';
import { ConfigService } from '@nestjs/config';
import { SecurityEventRecorder } from '../../src/session/events/security-event-recorder';
import { BrowserProofService } from '../../src/session/services/browser-proof.service';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import { ProofsEventsContractHarness } from '../utils/session/proofs-events-contract/proofs-events-contract-harness';
import { PostgresBrowserProofStore } from '../../src/session/persistence/postgres/postgres-browser-proof.store';
import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { openTestConnection } from './postgres-connection';

const AN_OBJECT_ID = '65f000000000000000000001';
const A_UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';
const SEEDED_OUTCOME = 'seeded';

export async function bootPostgresProofsEventsHarness(): Promise<ProofsEventsContractHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  const clock = new FrozenClock(TEST_NOW);
  const config = new ConfigService({ NODE_ENV: 'test' });
  const browserApplications = browserApplicationsForTest(config);
  const proofs = new PostgresBrowserProofStore(database);
  const events = new PostgresSecurityEventStore(database);

  return {
    clock,
    proofs,
    events,
    proofService: new BrowserProofService(
      proofs,
      config,
      clock,
      browserApplications,
    ),
    recorder: new SecurityEventRecorder(events, clock),
    runner: (pause) => new PostgresUnitOfWorkRunner(database, pause),

    seedProof: async (proof) => {
      await database
        .insertInto('browser_proofs')
        .values({
          proof_id_hash: proof.proofIdHash,
          token_hash: proof.tokenHash,
          expires_at: proof.expiresAt,
          spent: proof.spent,
        })
        .execute();
    },
    storedProof: async (proofIdHash) => {
      const row = await database
        .selectFrom('browser_proofs')
        .select(['token_hash', 'expires_at', 'spent'])
        .where('proof_id_hash', '=', proofIdHash)
        .executeTakeFirst();
      return row
        ? {
            tokenHash: row.token_hash,
            expiresAt: row.expires_at,
            spent: row.spent,
          }
        : null;
    },
    proofCount: async () => {
      const counted = await database
        .selectFrom('browser_proofs')
        .select((proof) => proof.fn.countAll<string>().as('total'))
        .executeTakeFirstOrThrow();
      return Number.parseInt(counted.total, 10);
    },

    seedEvent: async (event) => {
      await database
        .insertInto('security_events')
        .values({
          event_id: event.eventId,
          target_user_id: event.targetUserId ?? null,
          action: event.action,
          outcome: SEEDED_OUTCOME,
          occurred_at: event.occurredAt,
          purge_after: event.purgeAfter,
        })
        .execute();
    },
    storedEventIds: async () => {
      const rows = await database
        .selectFrom('security_events')
        .select('event_id')
        .orderBy('event_id')
        .execute();
      return rows.map((row) => row.event_id).sort();
    },

    ownAccountId: () => A_UUID,
    foreignAccountId: () => AN_OBJECT_ID,

    reset: connection.reset,
    close: connection.close,
  };
}

import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoUnitOfWorkRunner } from '../../../../src/session/persistence/mongo/mongo-unit-of-work';
import { SecurityEventRecorder } from '../../../../src/session/events/security-event-recorder';
import { SecurityEventStore } from '../../../../src/session/events/security-event.store';
import { BrowserProofStore } from '../../../../src/session/proofs/browser-proof.store';
import {
  BrowserProof,
  BrowserProofDocument,
} from '../../../../src/session/persistence/mongo/schemas/browser-proof.schema';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../../src/session/persistence/mongo/schemas/security-event.schema';
import { BrowserProofService } from '../../../../src/session/services/browser-proof.service';
import { FrozenClock, TEST_NOW } from '../../frozen-clock';
import { startMemoryReplSet } from '../../memory-replset';
import { bootSessionAuthority } from '../../session-authority-harness';
import { ProofsEventsContractHarness } from './proofs-events-contract-harness';

const AN_OBJECT_ID = '65f000000000000000000001';
const A_UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';
const SEEDED_OUTCOME = 'seeded';

export async function bootMongoProofsEventsHarness(): Promise<ProofsEventsContractHarness> {
  const mongo = await startMemoryReplSet();
  const clock = new FrozenClock(TEST_NOW);
  const { app, connection } = await bootSessionAuthority(
    mongo.uri('proofs_events_contract'),
    clock,
  );
  const proofs = app.get<Model<BrowserProofDocument>>(
    getModelToken(BrowserProof.name),
  );
  const events = app.get<Model<SecurityEventDocument>>(
    getModelToken(SecurityEvent.name),
  );

  return {
    clock,
    proofs: app.get(BrowserProofStore),
    events: app.get(SecurityEventStore),
    proofService: app.get(BrowserProofService),
    recorder: app.get(SecurityEventRecorder),
    runner: (pause) => new MongoUnitOfWorkRunner(connection, pause),

    seedProof: async (proof) => {
      await proofs.create(proof);
    },
    storedProof: async (proofIdHash) => {
      const proof = await proofs.findOne({ proofIdHash }).lean().exec();
      return proof
        ? {
            tokenHash: proof.tokenHash,
            expiresAt: proof.expiresAt,
            spent: proof.spent,
          }
        : null;
    },
    proofCount: () => proofs.countDocuments({}).exec(),

    seedEvent: async (event) => {
      await events.create({ ...event, outcome: SEEDED_OUTCOME });
    },
    storedEventIds: async () => {
      const stored = await events.find({}).select('eventId').lean().exec();
      return stored.map(({ eventId }) => eventId).sort();
    },

    ownAccountId: () => AN_OBJECT_ID,
    foreignAccountId: () => A_UUID,

    reset: async () => {
      await proofs.deleteMany({});
      await events.deleteMany({});
    },
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}

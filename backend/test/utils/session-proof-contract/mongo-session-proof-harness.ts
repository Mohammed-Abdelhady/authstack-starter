import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'mongoose';
import { MONGO_PROOF_PROVIDERS } from '../../../src/auth/proof/persistence/mongo/mongo-proof-persistence';
import {
  SessionProof,
  SessionProofSchema,
} from '../../../src/auth/proof/persistence/mongo/session-proof.schema';
import { SessionProofStore } from '../../../src/auth/proof/stores/session-proof.store';
import { MongoUnitOfWorkRunner } from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import { FrozenClock, TEST_NOW } from '../frozen-clock';
import { startMemoryReplSet } from '../memory-replset';
import { SessionProofHarness } from './session-proof-harness';

export async function bootMongoSessionProofHarness(): Promise<SessionProofHarness> {
  const mongo = await startMemoryReplSet();
  const connection = createConnection(mongo.uri('session_proof_contract'));
  let module: TestingModule | undefined;
  const close = async (): Promise<void> => {
    try {
      await module?.close();
    } finally {
      try {
        await connection.close();
      } finally {
        await mongo.stop();
      }
    }
  };
  try {
    await connection.asPromise();
    const proofs = connection.model(SessionProof.name, SessionProofSchema);
    await proofs.init();
    module = await Test.createTestingModule({
      providers: [
        ...MONGO_PROOF_PROVIDERS,
        { provide: getModelToken(SessionProof.name), useValue: proofs },
      ],
    }).compile();
    return {
      store: module.get(SessionProofStore),
      clock: new FrozenClock(TEST_NOW),
      runner: () => new MongoUnitOfWorkRunner(connection),
      seedSession: (userId = randomUUID()) =>
        Promise.resolve({
          userId,
          sessionId: randomUUID(),
          clientId: 'staff-console',
        }),
      purgeAfter: async (ref) => {
        const row = await proofs
          .findOne({
            _id: ref.sessionId,
            userId: ref.userId,
            clientId: ref.clientId,
          })
          .lean()
          .exec();
        return row?.purgeAfter ?? null;
      },
      reset: async () => {
        await proofs.deleteMany({}).exec();
      },
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

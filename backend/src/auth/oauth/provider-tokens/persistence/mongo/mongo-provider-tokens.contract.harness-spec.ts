import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import { startMemoryReplSet } from '../../../../../../test/utils/memory-replset';
import { MongoUnitOfWorkRunner } from '../../../../../session/persistence/mongo/mongo-unit-of-work';
import type { ProviderTokensHarness } from '../../provider-tokens.contract.harness-spec';
import type { SealedToken } from '../../types/provider-tokens';
import {
  MongoProviderTokenStore,
  PROVIDER_TOKEN_COLLECTION,
  PROVIDER_REVOCATION_COLLECTION,
} from './mongo-provider-token.store';

type JobRow = Awaited<ReturnType<ProviderTokensHarness['jobRows']>>[number];
interface StoredJob extends Omit<JobRow, 'id' | 'sealed'> {
  _id: ObjectId;
  ciphertext: string | null;
  iv: string | null;
  tag: string | null;
  keyId: string | null;
}
interface StoredToken extends SealedToken {
  provider: string;
  subject: string;
  clientId: string;
  storedAt: Date;
}

export async function bootMongoProviderTokensHarness(): Promise<ProviderTokensHarness> {
  const server = await startMemoryReplSet();
  let connection: mongoose.Connection | undefined;
  try {
    connection = await mongoose
      .createConnection(server.uri('provider-tokens'))
      .asPromise();
    const db = connection.db;
    if (!db) throw new Error('MongoDB connection has no database');
    const opened = connection;
    const tokens = db.collection<StoredToken>(PROVIDER_TOKEN_COLLECTION);
    const jobs = db.collection<StoredJob>(PROVIDER_REVOCATION_COLLECTION);
    const users = db.collection('users');
    const store = new MongoProviderTokenStore(db);
    await store.ensureIndexes();
    return {
      store,
      clock: new FrozenClock(TEST_NOW),
      userId: '000000000000000000000001',
      unitOfWork: new MongoUnitOfWorkRunner(opened),
      reset: async () => {
        await tokens.deleteMany({});
        await jobs.deleteMany({});
        await users.deleteMany({});
      },
      close: async () => {
        try {
          await opened.close();
        } finally {
          await server.stop();
        }
      },
      checkSetup: async () => {
        const tokenIndexes = await tokens.indexes();
        expect(
          tokenIndexes.find(
            ({ name }) => name === 'provider_token_identity_client_unique',
          ),
        ).toMatchObject({
          key: { provider: 1, subject: 1, clientId: 1 },
          unique: true,
        });
        expect(
          tokenIndexes.find(
            ({ name }) => name === 'provider_token_check_after',
          ),
        ).toMatchObject({ key: { checkAfter: 1 } });
        const jobIndexes = await jobs.indexes();
        expect(
          jobIndexes.find(
            ({ name }) => name === 'provider_revocation_purge_after',
          ),
        ).toMatchObject({ key: { purgeAfter: 1 }, expireAfterSeconds: 0 });
        expect(
          jobIndexes.find(({ name }) => name === 'provider_revocation_due'),
        ).toMatchObject({ key: { state: 1, nextAttemptAt: 1 } });
        expect(
          jobIndexes.find(({ name }) => name === 'provider_revocation_flagged'),
        ).toMatchObject({
          key: { flaggedAt: -1 },
          partialFilterExpression: { flaggedAt: { $exists: true } },
        });
      },
      cleanUp: () => Promise.resolve(),
      link: async (subject) => {
        await users.insertOne({
          email: `${subject}@example.test`,
          linkedAccounts: [
            { provider: 'apple', providerId: subject, linkedAt: TEST_NOW },
          ],
        });
      },
      tokenRows: async () => {
        const rows = await tokens.find().sort({ clientId: 1 }).toArray();
        return rows.map((row) => ({
          provider: row.provider,
          subject: row.subject,
          clientId: row.clientId,
          sealed: {
            ciphertext: row.ciphertext,
            iv: row.iv,
            tag: row.tag,
            keyId: row.keyId,
          },
          storedAt: row.storedAt,
        }));
      },
      jobRows: async () => {
        const rows = await jobs.find().toArray();
        return rows.map((row) => ({
          id: row._id.toHexString(),
          subject: row.subject,
          clientId: row.clientId,
          state: row.state,
          outcome: row.outcome,
          attempts: row.attempts,
          failureCode: row.failureCode,
          flaggedAt: row.flaggedAt,
          nextAttemptAt: row.nextAttemptAt,
          leaseUntil: row.leaseUntil,
          settledAt: row.settledAt,
          purgeAfter: row.purgeAfter,
          sealed:
            row.ciphertext !== null &&
            row.iv !== null &&
            row.tag !== null &&
            row.keyId !== null
              ? {
                  ciphertext: row.ciphertext,
                  iv: row.iv,
                  tag: row.tag,
                  keyId: row.keyId,
                }
              : null,
        }));
      },
    };
  } catch (error) {
    try {
      await connection?.close();
    } finally {
      await server.stop();
    }
    throw error;
  }
}

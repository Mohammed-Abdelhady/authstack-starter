import {
  PENDING_PURPOSE,
  MAIL_COUNTER_PURPOSE,
} from '../../../../auth/constants/registration';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { startMemoryReplSet } from '../../../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import { MongoUnitOfWorkRunner } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { UserSchema } from '../../../persistence/mongo/schemas/user.schema';
import type {
  ErasureAccount,
  ErasureHarness,
} from '../../erasure.contract.harness-spec';
import { MongoAccountDeletionStore } from './mongo-account-deletion.store';
import { MongoAccountEraser } from './mongo-account-eraser';
import { MongoErasureJobStore } from './mongo-erasure-job.store';

export async function bootMongoErasureHarness(): Promise<ErasureHarness> {
  const server = await startMemoryReplSet();
  const connection = await mongoose
    .createConnection(server.uri('erasure-contract'))
    .asPromise();
  const openedDb = connection.db;
  if (!openedDb) throw new Error('MongoDB connection has no database');
  const db = openedDb;
  const users = connection.model('User', UserSchema);
  await users.init();
  const jobs = new MongoErasureJobStore(db);
  const deletion = new MongoAccountDeletionStore(db);
  await jobs.ensureIndexes();
  await deletion.ensureIndexes();
  const tracked = new Map<
    string,
    Map<string, { collection: string; ids: (ObjectId | string)[] }>
  >();
  const clock = new FrozenClock(TEST_NOW);
  async function seedChildren(a: ErasureAccount): Promise<void> {
    const rows = new Map<
      string,
      { collection: string; ids: (ObjectId | string)[] }
    >();
    tracked.set(a.id, rows);
    async function add(
      label: string,
      collection: string,
      values: Record<string, unknown>,
    ): Promise<ObjectId> {
      const id = new ObjectId();
      await db.collection(collection).insertOne({ _id: id, ...values });
      const entry = rows.get(label) ?? { collection, ids: [] };
      entry.ids.push(id);
      rows.set(label, entry);
      return id;
    }
    const userId = new ObjectId(a.id);
    rows.set('users', { collection: 'users', ids: [userId] });
    const expiry = new Date('2099-01-02T12:00:00.000Z');
    const session = await add('sessions', 'sessions', {
      user: userId,
      expiresAt: expiry,
    });
    await add('credentials', 'nativecredentials', {
      sessionId: session,
      tokenHash: a.id,
      expiresAt: expiry,
    });
    await add('authorization', 'authorizationtransactions', {
      userId,
      transactionId: a.id,
      expiresAt: expiry,
    });
    await add('grants', 'userapplicationgrants', {
      userId,
      clientId: 'contract',
    });
    await db.collection('users').updateOne(
      { _id: userId },
      {
        $set: {
          linkedAccounts: [
            { provider: 'google', providerId: a.email, linkedAt: TEST_NOW },
          ],
        },
      },
    );
    rows.set('linked', { collection: 'users', ids: [userId] });
    // feature:passkeys:start
    await add('passkeys', 'passkeys', { user: userId, credentialId: a.id });
    await add('passkeyChallenges', 'passkeychallenges', {
      user: userId,
      challengeHash: `${a.id}:user`,
      expiresAt: expiry,
    });
    await add('passkeyChallenges', 'passkeychallenges', {
      sessionId: session.toHexString(),
      challengeHash: `${a.id}:session`,
      expiresAt: expiry,
    });
    // feature:passkeys:end
    // feature:totp:start
    await add('twoFactor', 'twofactorchallenges', {
      user: userId,
      nonceHash: a.id,
      expiresAt: expiry,
    });
    // feature:totp:end
    // feature:oauth-core:start
    await add('tickets', 'provider_link_tickets', {
      userId: a.id,
      sessionId: session.toHexString(),
      ticketHash: a.id,
      expiresAt: expiry,
    });
    // feature:oauth-core:end
    await add('attempts', 'native_attempts', {
      attemptId: `${a.id}:user`,
      details: { verifiedAccount: { userId: a.id } },
      expiresAt: expiry,
    });
    await add('attempts', 'native_attempts', {
      attemptId: `${a.id}:address`,
      details: { email: { address: a.pendingEmail.trim().toLowerCase() } },
      expiresAt: expiry,
    });
    const address = a.pendingEmail.trim().toLowerCase();
    await db
      .collection<{ _id: string; owner: string; kind: string; lapsesAt: Date }>(
        'addressclaims',
      )
      .insertOne({
        _id: address,
        owner: a.id,
        kind: 'EMAIL_CHANGE',
        lapsesAt: expiry,
      });
    rows.set('claims', { collection: 'addressclaims', ids: [address] });
    await add('registrations', 'pendingregistrations', {
      userId,
      email: `bound-${a.email}`,
      purpose: PENDING_PURPOSE.EMAIL_CHANGE,
      expiresAt: expiry,
    });
    await add('registrations', 'pendingregistrations', {
      email: a.pendingEmail,
      purpose: PENDING_PURPOSE.SIGNUP,
      expiresAt: expiry,
    });
    for (const email of [a.email, a.pendingEmail.trim().toLowerCase()]) {
      await add('resets', 'pendingpasswordresets', {
        email,
        expiresAt: expiry,
      });
      await add('counters', 'mailcounters', {
        email,
        purpose: MAIL_COUNTER_PURPOSE.SIGNUP,
        expiresAt: expiry,
      });
      // feature:magic-link:start
      await add('magicLinks', 'pendingmagiclinks', {
        email,
        tokenHash: `${a.id}:${email}`,
        expiresAt: expiry,
      });
      // feature:magic-link:end
      // feature:email-code:start
      await add('emailCodes', 'email_codes', {
        email,
        ownerId: email,
        purpose: 'sign-in',
        expiresAt: expiry,
        purgeAfter: expiry,
      });
      // feature:email-code:end
    }
    for (const role of ['actor', 'target']) {
      await db.collection('securityevents').insertOne({
        eventId: `${a.id}:${role}`,
        actorId: role === 'actor' ? a.id : 'unrelated',
        targetUserId: role === 'target' ? a.id : 'unrelated',
        action: 'account.updated',
        details: {
          name: 'Personal',
          email: a.email,
          changedFields: ['role'],
        },
        purgeAfter: expiry,
      });
    }
  }
  return {
    jobs,
    deletion,
    eraser: new MongoAccountEraser(db),
    runner: new MongoUnitOfWorkRunner(connection),
    clock,
    seedAccount: async (email, deleted = false, eraseAfter) => {
      const id = new ObjectId();
      const pendingEmail = ` Pending-${email} `;
      await db.collection('users').insertOne({
        _id: id,
        email,
        pendingEmail,
        name: 'Contract',
        isDeleted: deleted,
        ...(eraseAfter ? { eraseAfter } : {}),
      });
      return { id: id.toHexString(), email, pendingEmail };
    },
    schedule: async (id) => {
      const user = await db
        .collection<{ _id: ObjectId; eraseAfter?: Date }>('users')
        .findOne({ _id: new ObjectId(id) });
      return user?.eraseAfter ?? null;
    },
    deactivate: async (id, deletedAt) => {
      await db
        .collection('users')
        .updateOne(
          { _id: new ObjectId(id) },
          { $set: { isDeleted: true, deletedAt } },
        );
    },
    seedChildren,
    counts: async (a) => {
      const rows = tracked.get(a.id);
      if (!rows) throw new Error('Account children were not seeded');
      const counts: Record<string, number> = {};
      for (const [label, entry] of rows) {
        counts[label] = await db
          .collection<{ _id: ObjectId | string }>(entry.collection)
          .countDocuments({ _id: { $in: entry.ids } });
      }
      return counts;
    },
    events: async () => {
      const rows = await db
        .collection<{
          eventId: string;
          actorId: string;
          targetUserId: string;
          action: string;
          details: Record<string, unknown>;
        }>('securityevents')
        .find({})
        .toArray();
      return rows.map((row) => ({
        eventId: row.eventId,
        actorId: row.actorId,
        targetUserId: row.targetUserId,
        action: row.action,
        details: row.details,
      }));
    },
    reset: async () => {
      for (const collection of await db.listCollections().toArray())
        await db.collection(collection.name).deleteMany({});
      tracked.clear();
    },
    close: async () => {
      await connection.close();
      await server.stop();
    },
    checkSetup: async () => {
      const indexes = await db.collection('erasure_jobs').indexes();
      expect(indexes.map((index) => index.name)).toEqual(
        expect.arrayContaining([
          'erasure_job_user_unique',
          'erasure_job_purge_after',
          'erasure_job_open',
        ]),
      );
      expect(
        indexes.find((index) => index.name === 'erasure_job_user_unique')
          ?.unique,
      ).toBe(true);
      expect(
        indexes.find((index) => index.name === 'erasure_job_purge_after')
          ?.expireAfterSeconds,
      ).toBe(0);
      const receipts = await db
        .collection('account_deletion_receipts')
        .indexes();
      expect(
        receipts.find(
          (index) => index.name === 'account_deletion_receipt_purge_after',
        )?.expireAfterSeconds,
      ).toBe(0);
      const due = (await db.collection('users').indexes()).find(
        (index) => index.name === 'user_erase_due',
      );
      expect(due?.key).toEqual({ eraseAfter: 1 });
      expect(due?.partialFilterExpression).toEqual({
        isDeleted: true,
        eraseAfter: { $exists: true },
      });
    },
  };
}

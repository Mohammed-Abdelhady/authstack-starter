import { Db, MongoClient, ObjectId } from 'mongodb';
import { PENDING_PURPOSE } from '../../../src/auth/constants/registration';
import { hashOf } from '../auth/pending-codes-contract/pending-codes-contract-support';
import { bootMongoAccountsHarness } from '../user/accounts-contract/mongo-accounts-harness';
import { servicesOn } from '../user/accounts-contract/accounts-contract-support';

const ADDRESS = 'a@x.com';
const CODE = '123456';
const KEEPER_CODE_ID = '66f000000000000000000001';
const LOSER_CODE_ID = '66f000000000000000000002';
const EXPIRES_AT = new Date('2099-01-01T13:00:00.000Z');

interface LegacyCode {
  _id: ObjectId;
  email: string;
  purpose: string;
  userId: ObjectId;
  addressGeneration: number;
  attempts: number;
  expiresAt: Date;
  hashedCode: string;
}

export async function withMigrationDate<Result>(
  now: Date,
  work: () => Promise<Result>,
): Promise<Result> {
  jest.useFakeTimers({
    now,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  try {
    return await work();
  } finally {
    jest.useRealTimers();
  }
}

/** A retained legacy code must remain usable through real confirmation. */
export async function confirmMigratedEmailChange(
  migrate: (db: Db, client: MongoClient) => Promise<void>,
): Promise<void> {
  const harness = await bootMongoAccountsHarness();
  try {
    const keeperId = await harness.seedAccount({
      email: 'old@x.com',
      pendingEmail: ADDRESS,
      addressGeneration: 7,
      role: 'user',
    });
    const loserId = await harness.seedAccount({
      email: 'other@x.com',
      pendingEmail: ADDRESS,
      addressGeneration: 1,
      role: 'user',
    });
    const client = harness.booted.connection.getClient();
    const database = client.db(harness.booted.connection.name);
    await database
      .collection('users')
      .updateOne(
        { _id: new ObjectId(keeperId) },
        { $set: { pendingEmail: ' A@X.com ' } },
      );
    const codes = database.collection<LegacyCode>('pendingregistrations');
    const hashedCode = await hashOf(CODE);
    await codes.insertMany([
      {
        _id: new ObjectId(KEEPER_CODE_ID),
        email: ' A@X.com ',
        purpose: PENDING_PURPOSE.EMAIL_CHANGE,
        userId: new ObjectId(keeperId),
        addressGeneration: 7,
        attempts: 0,
        expiresAt: EXPIRES_AT,
        hashedCode,
      },
      {
        _id: new ObjectId(LOSER_CODE_ID),
        email: ADDRESS,
        purpose: PENDING_PURPOSE.EMAIL_CHANGE,
        userId: new ObjectId(loserId),
        addressGeneration: 0,
        attempts: 0,
        expiresAt: EXPIRES_AT,
        hashedCode,
      },
    ]);

    await withMigrationDate(harness.clock.now(), () =>
      migrate(database, client),
    );
    expect(
      await codes.findOne({ _id: new ObjectId(LOSER_CODE_ID) }),
    ).toBeNull();
    const kept = await codes.findOne({ email: ADDRESS });
    expect({ id: kept?._id.toString(), email: kept?.email }).toEqual({
      id: KEEPER_CODE_ID,
      email: ADDRESS,
    });
    expect(await codes.countDocuments({})).toBe(1);
    expect(await harness.account(loserId)).toMatchObject({
      email: 'other@x.com',
      pendingEmail: null,
    });
    const services = servicesOn(harness);
    await services.emailChange.confirm({ email: ADDRESS, code: CODE });
    expect(await harness.account(keeperId)).toMatchObject({
      email: ADDRESS,
      pendingEmail: null,
      isVerified: true,
    });
    expect(await harness.claims()).toEqual([]);
    expect(await codes.countDocuments({})).toBe(0);
  } finally {
    await harness.close();
  }
}

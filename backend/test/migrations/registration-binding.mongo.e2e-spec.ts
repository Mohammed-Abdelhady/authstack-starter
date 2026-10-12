import { Db, MongoClient, ObjectId } from 'mongodb';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../utils/memory-replset';
import { createRequire } from 'node:module';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const nodeRequire = createRequire(__filename);
const registrationBinding = nodeRequire(
  '../../migrations/20261003000001-registration-binding.js',
) as {
  up: (db: Db, client?: unknown) => Promise<void>;
  down: (db: Db, client?: unknown) => Promise<void>;
};

const LIVE_EXPIRY = new Date('2099-01-01T13:00:00.000Z');

function pendingDoc(
  email: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    email,
    name: 'Legacy',
    hashedCode: 'legacy-code',
    attempts: 0,
    expiresAt: LIVE_EXPIRY,
    ...overrides,
  };
}

describe('registration binding migration', () => {
  let mongo: MemoryReplSet;
  let client: MongoClient;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    client = await MongoClient.connect(mongo.getUri());
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await client.close();
    await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await client.db().dropDatabase();
  });

  it('deletes old sign-ups, converts live confirmations and drops the rest', async () => {
    const pending = client.db().collection('pendingregistrations');
    const users = client.db().collection('users');
    await pending.createIndex({ email: 1 }, { unique: true, name: 'email_1' });

    const movedUserId = new ObjectId();
    await users.insertOne({
      _id: movedUserId,
      email: 'moved@example.test',
      isVerified: false,
      addressGeneration: 5,
    });
    await users.insertOne({
      _id: new ObjectId(),
      email: 'verified@example.test',
      isVerified: true,
      addressGeneration: 0,
    });

    await pending.insertMany([
      pendingDoc('old-signup@example.test', { hashedPassword: 'old-hash' }),
      pendingDoc('moved@example.test'),
      pendingDoc('orphan@example.test'),
      pendingDoc('verified@example.test'),
      pendingDoc('already-new@example.test', { purpose: 'signup' }),
    ]);

    await registrationBinding.up(client.db());

    expect(
      await pending.countDocuments({ email: 'old-signup@example.test' }),
    ).toBe(0);
    expect(await pending.countDocuments({ email: 'orphan@example.test' })).toBe(
      0,
    );
    expect(
      await pending.countDocuments({ email: 'verified@example.test' }),
    ).toBe(0);
    expect(
      await pending.countDocuments({ email: 'already-new@example.test' }),
    ).toBe(1);

    const converted = await pending.findOne({ email: 'moved@example.test' });
    expect(converted?.purpose).toBe('email-change');
    expect(String(converted?.userId)).toBe(movedUserId.toString());
    expect(converted?.addressGeneration).toBe(5);

    expect(await pending.indexExists('email_1')).toBe(false);
    expect(await pending.indexExists('email_1_purpose_1')).toBe(true);
  });

  it('keeps the old unique index when creating the replacement fails', async () => {
    const pending = client.db().collection('pendingregistrations');
    await pending.createIndex({ email: 1 }, { unique: true, name: 'email_1' });
    // A non-unique index with the replacement's name makes the migration's
    // createIndex throw, before it would have dropped the old index.
    await pending.createIndex(
      { email: 1, purpose: 1 },
      { name: 'email_1_purpose_1' },
    );

    await expect(registrationBinding.up(client.db())).rejects.toThrow();

    expect(await pending.indexExists('email_1')).toBe(true);
  });

  it('leaves the new data and index in place on down', async () => {
    const pending = client.db().collection('pendingregistrations');
    await pending.insertOne(
      pendingDoc('already-new@example.test', { purpose: 'signup' }),
    );

    await registrationBinding.up(client.db());
    await registrationBinding.down(client.db());

    expect(
      await pending.countDocuments({ email: 'already-new@example.test' }),
    ).toBe(1);
    expect(await pending.indexExists('email_1_purpose_1')).toBe(true);
  });

  it('runs twice without changing the result', async () => {
    const pending = client.db().collection('pendingregistrations');
    const users = client.db().collection('users');
    await pending.createIndex({ email: 1 }, { unique: true, name: 'email_1' });
    await users.insertOne({
      _id: new ObjectId(),
      email: 'moved@example.test',
      isVerified: false,
      addressGeneration: 2,
    });
    await pending.insertOne(pendingDoc('moved@example.test'));

    await registrationBinding.up(client.db());
    await registrationBinding.up(client.db());

    expect(await pending.countDocuments({ email: 'moved@example.test' })).toBe(
      1,
    );
    const converted = await pending.findOne({ email: 'moved@example.test' });
    expect(converted?.purpose).toBe('email-change');
    expect(await pending.indexExists('email_1')).toBe(false);
    expect(await pending.indexExists('email_1_purpose_1')).toBe(true);
  });

  it('creates the replacement index on an empty database', async () => {
    const pending = client.db().collection('pendingregistrations');

    await registrationBinding.up(client.db());

    expect(await pending.countDocuments({})).toBe(0);
    expect(await pending.indexExists('email_1_purpose_1')).toBe(true);
  });
});

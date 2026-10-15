import { createRequire } from 'node:module';
import { Db, MongoClient, ObjectId } from 'mongodb';
import { startMemoryReplSet, MemoryReplSet } from '../utils/memory-replset';
import {
  confirmMigratedEmailChange,
  withMigrationDate,
} from '../utils/mongo/address-ledger-migration';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const nodeRequire = createRequire(__filename);
const migration = nodeRequire(
  '../../migrations/20261009000002-address-ledger.js',
) as {
  up(db: Db, client: MongoClient): Promise<void>;
  down(db: Db, client: MongoClient): Promise<void>;
};
const FIRST_ID = '65f000000000000000000001';
const SECOND_ID = '65f000000000000000000002';
const THIRD_ID = '65f000000000000000000003';
const USER_IDS = [
  FIRST_ID,
  SECOND_ID,
  THIRD_ID,
  '65f000000000000000000004',
  '65f000000000000000000005',
  '65f000000000000000000006',
  '65f000000000000000000007',
  '65f000000000000000000008',
  '65f000000000000000000009',
  '65f00000000000000000000a',
  '65f00000000000000000000b',
  '65f00000000000000000000c',
  '65f00000000000000000000d',
];
const MIGRATION_NOW = new Date('2099-01-01T12:00:00.000Z');
const LIVE_EXPIRY = new Date('2099-01-01T13:00:00.000Z');
const EARLIER_EXPIRY = new Date('2099-01-01T12:30:00.000Z');
const SELECTED_CODE_ID = '66f000000000000000000003';
const ZERO_COUNTS =
  'Address ledger backfill: kept=0 cleared_taken=0 cleared_ambiguous=0 cleared_codeless=0 codes_killed=0';
const BACKFILL_COUNTS =
  'Address ledger backfill: kept=2 cleared_taken=1 cleared_ambiguous=5 cleared_codeless=4 codes_killed=9';
const HANDOFF_COUNTS =
  'Address ledger backfill: kept=1 cleared_taken=0 cleared_ambiguous=1 cleared_codeless=0 codes_killed=1';

interface LegacyUser {
  _id: ObjectId;
  email?: string | null;
  pendingEmail?: string;
  addressGeneration?: number;
  isDeleted?: boolean;
}

interface LegacyCode {
  _id?: ObjectId;
  email: string;
  purpose: string;
  userId?: ObjectId;
  addressGeneration?: number;
  expiresAt: Date;
  hashedCode: string;
}

async function migrate(db: Db, client: MongoClient, expected: string) {
  const output = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await migration.up(db, client);
    expect(output.mock.calls).toEqual([[expected]]);
  } finally {
    output.mockRestore();
  }
}

async function seedBackfill(db: Db) {
  const pending = [
    undefined,
    ' TAKEN@Example.Test ',
    ' Shared@Example.Test ',
    'shared@example.test',
    ' Orphan@Example.Test ',
    'orphan@example.test',
    ' Stale@Example.Test ',
    ' Expired@Example.Test ',
    ' Solo@Example.Test ',
    ' Codeless@Example.Test ',
    ' Ambiguous@Example.Test ',
    'ambiguous@example.test',
    ' Wrong@Example.Test ',
  ];
  const generations = [0, 1, 7, 1, 0, 0, 4, 1, 2, 0, 1, 1, 1];
  await db.collection<LegacyUser>('users').insertMany(
    USER_IDS.map((id, index) => ({
      _id: new ObjectId(id),
      email: index === 0 ? ' Taken@Example.Test ' : `${id}@example.test`,
      ...(pending[index] === undefined ? {} : { pendingEmail: pending[index] }),
      addressGeneration: generations[index],
      isDeleted: index === 0,
    })),
  );
  const codes: [string, number, number, Date, string?][] = [
    [' taken@EXAMPLE.test ', 1, 1, LIVE_EXPIRY],
    [' SHARED@example.test ', 2, 7, LIVE_EXPIRY, '66f000000000000000000002'],
    [' Shared@EXAMPLE.test ', 2, 7, EARLIER_EXPIRY, '66f000000000000000000004'],
    [' SHARED@EXAMPLE.TEST ', 2, 7, LIVE_EXPIRY, SELECTED_CODE_ID],
    ['shared@example.test', 3, 0, LIVE_EXPIRY],
    ['stale@example.test', 6, 3, LIVE_EXPIRY],
    ['expired@example.test', 7, 1, MIGRATION_NOW],
    [' SOLO@example.test ', 8, 2, LIVE_EXPIRY],
    [' Ambiguous@example.test ', 10, 1, LIVE_EXPIRY],
    ['ambiguous@example.test', 11, 1, LIVE_EXPIRY],
    ['wrong@example.test', 2, 1, LIVE_EXPIRY],
    ['unrelated@example.test', 2, 7, LIVE_EXPIRY],
  ];
  await db.collection<LegacyCode>('pendingregistrations').insertMany([
    ...codes.map(([email, owner, addressGeneration, expiresAt, id]) => ({
      ...(id === undefined ? {} : { _id: new ObjectId(id) }),
      email,
      purpose: 'email-change',
      userId: new ObjectId(USER_IDS[owner]),
      addressGeneration,
      expiresAt,
      hashedCode: 'legacy-hash',
    })),
    {
      email: ' taken@EXAMPLE.test ',
      purpose: 'signup',
      expiresAt: LIVE_EXPIRY,
      hashedCode: 'signup-hash',
    },
  ]);
}

async function expectBackfilled(db: Db) {
  const users = await db
    .collection<LegacyUser>('users')
    .find({})
    .sort({ _id: 1 })
    .toArray();
  expect(users.map((user) => user.pendingEmail)).toEqual([
    undefined,
    undefined,
    'shared@example.test',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'solo@example.test',
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  const claims = await db
    .collection<{
      _id: string;
      kind: string;
      owner: string;
      lapsesAt: Date;
    }>('addressclaims')
    .find({})
    .sort({ _id: 1 })
    .toArray();
  expect(claims).toEqual([
    {
      _id: 'shared@example.test',
      kind: 'EMAIL_CHANGE',
      owner: THIRD_ID,
      lapsesAt: LIVE_EXPIRY,
    },
    {
      _id: 'solo@example.test',
      kind: 'EMAIL_CHANGE',
      owner: USER_IDS[8],
      lapsesAt: LIVE_EXPIRY,
    },
  ]);
  const codes = await db
    .collection<LegacyCode>('pendingregistrations')
    .find({})
    .sort({ email: 1, purpose: 1 })
    .toArray();
  expect(codes.map(({ email, purpose }) => ({ email, purpose }))).toEqual([
    { email: ' taken@EXAMPLE.test ', purpose: 'signup' },
    { email: 'shared@example.test', purpose: 'email-change' },
    { email: 'solo@example.test', purpose: 'email-change' },
    { email: 'unrelated@example.test', purpose: 'email-change' },
  ]);
  expect(
    codes.find((code) => code.email === 'shared@example.test')?._id?.toString(),
  ).toBe(SELECTED_CODE_ID);
}

describe('address ledger MongoDB migration', () => {
  let mongo: MemoryReplSet;
  let client: MongoClient;
  const users = () => client.db().collection<LegacyUser>('users');
  const emails = async () =>
    (await users().find({}).sort({ _id: 1 }).toArray()).map((row) => ({
      id: row._id.toString(),
      email: row.email,
    }));

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    client = await MongoClient.connect(mongo.getUri());
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await client?.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    await client.db().dropDatabase();
  });

  it('normalises strings, preserves null and missing, and reruns unchanged', async () => {
    await users().insertMany([
      { _id: new ObjectId(FIRST_ID), email: ' Foo@Example.COM ' },
      { _id: new ObjectId(SECOND_ID), email: null },
      { _id: new ObjectId(THIRD_ID) },
    ]);
    await migrate(client.db(), client, ZERO_COUNTS);
    expect(await emails()).toEqual([
      { id: FIRST_ID, email: 'foo@example.com' },
      { id: SECOND_ID, email: null },
      { id: THIRD_ID, email: undefined },
    ]);
    await migrate(client.db(), client, ZERO_COUNTS);
    expect(await emails()).toEqual([
      { id: FIRST_ID, email: 'foo@example.com' },
      { id: SECOND_ID, email: null },
      { id: THIRD_ID, email: undefined },
    ]);
  });

  it('backfills only live bindings, clears unsafe pending data and replays once', async () => {
    await seedBackfill(client.db());
    await withMigrationDate(MIGRATION_NOW, async () => {
      await migrate(client.db(), client, BACKFILL_COUNTS);
      await expectBackfilled(client.db());
      await migrate(client.db(), client, ZERO_COUNTS);
      await expectBackfilled(client.db());
    });
  });

  it('confirms the canonical code retained by the migration', async () => {
    await confirmMigratedEmailChange((db, migrationClient) =>
      migrate(db, migrationClient, HANDOFF_COUNTS),
    );
  });

  it('reports both colliding ids before changing even unrelated emails', async () => {
    await users().createIndex({ email: 1 }, { unique: true });
    await users().insertMany([
      { _id: new ObjectId(FIRST_ID), email: ' A@X.com ' },
      { _id: new ObjectId(SECOND_ID), email: 'a@x.com' },
      { _id: new ObjectId(THIRD_ID), email: ' Other@X.com ' },
    ]);
    const failed = migration.up(client.db(), client);
    await expect(failed).rejects.toThrow(FIRST_ID);
    await expect(failed).rejects.toThrow(SECOND_ID);
    await expect(failed).rejects.toThrow('2 users');
    expect(await emails()).toEqual([
      { id: FIRST_ID, email: ' A@X.com ' },
      { id: SECOND_ID, email: 'a@x.com' },
      { id: THIRD_ID, email: ' Other@X.com ' },
    ]);
  });

  it('allows empty data and retains canonical data on down', async () => {
    await migrate(client.db(), client, ZERO_COUNTS);
    expect(await emails()).toEqual([]);
    await users().insertOne({
      _id: new ObjectId(FIRST_ID),
      email: ' A@X.com ',
    });
    await migrate(client.db(), client, ZERO_COUNTS);
    await migration.down(client.db(), client);
    expect(await emails()).toEqual([{ id: FIRST_ID, email: 'a@x.com' }]);
  });
});

import { createRequire } from 'node:module';
import { Db, MongoClient, ObjectId } from 'mongodb';
import { startMemoryReplSet, MemoryReplSet } from '../utils/memory-replset';
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

describe('address ledger MongoDB migration', () => {
  let mongo: MemoryReplSet;
  let client: MongoClient;
  const users = () => client.db().collection('users');
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
    await migration.up(client.db(), client);
    expect(await emails()).toEqual([
      { id: FIRST_ID, email: 'foo@example.com' },
      { id: SECOND_ID, email: null },
      { id: THIRD_ID, email: undefined },
    ]);
    await migration.up(client.db(), client);
    expect(await emails()).toEqual([
      { id: FIRST_ID, email: 'foo@example.com' },
      { id: SECOND_ID, email: null },
      { id: THIRD_ID, email: undefined },
    ]);
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
    await migration.up(client.db(), client);
    expect(await emails()).toEqual([]);
    await users().insertOne({
      _id: new ObjectId(FIRST_ID),
      email: ' A@X.com ',
    });
    await migration.up(client.db(), client);
    await migration.down(client.db(), client);
    expect(await emails()).toEqual([{ id: FIRST_ID, email: 'a@x.com' }]);
  });
});

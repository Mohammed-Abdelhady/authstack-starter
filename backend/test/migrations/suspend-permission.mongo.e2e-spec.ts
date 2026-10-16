import { Db, MongoClient } from 'mongodb';
import { createRequire } from 'node:module';
import { startMemoryReplSet, MemoryReplSet } from '../utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const nodeRequire = createRequire(__filename);
const migration = nodeRequire(
  '../../migrations/20261016000001-suspend-permission.js',
) as {
  up(db: Db): Promise<void>;
  down(db: Db): Promise<void>;
};
const COLLECTIONS = ['users', 'roles'];
const UPDATE_ALL = 'users:update:all';
const UPDATE_STAFF = 'users:update:staff';
const READ_ALL = 'users:read:all';
const SUSPEND_ALL = 'users:suspend:all';
const SUSPEND_STAFF = 'users:suspend:staff';

function originalGrants(): Array<{ label: string; permissions: string[] }> {
  return [
    { label: 'all', permissions: [UPDATE_ALL] },
    { label: 'existing', permissions: [UPDATE_ALL, UPDATE_STAFF, SUSPEND_ALL] },
    { label: 'reader', permissions: [READ_ALL] },
    { label: 'staff', permissions: [UPDATE_STAFF] },
  ];
}

describe('suspend permission migration', () => {
  let mongo: MemoryReplSet;
  let client: MongoClient;
  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    client = await MongoClient.connect(mongo.getUri());
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    try {
      await client?.close();
    } finally {
      await mongo?.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    await client.db().dropDatabase();
  });

  it('preserves suspension authority and removes only grants added by up', async () => {
    const db = client.db();
    for (const collection of COLLECTIONS)
      await db.collection(collection).insertMany(originalGrants());
    await migration.up(db);
    await migration.up(db);
    for (const collection of COLLECTIONS) {
      const rows = await db
        .collection(collection)
        .find({})
        .sort({ label: 1 })
        .toArray();
      expect(
        rows.map(({ label, permissions }) => ({ label, permissions })),
      ).toEqual([
        { label: 'all', permissions: [UPDATE_ALL, SUSPEND_ALL] },
        {
          label: 'existing',
          permissions: [UPDATE_ALL, UPDATE_STAFF, SUSPEND_ALL, SUSPEND_STAFF],
        },
        { label: 'reader', permissions: [READ_ALL] },
        { label: 'staff', permissions: [UPDATE_STAFF, SUSPEND_STAFF] },
      ]);
      await db
        .collection(collection)
        .updateOne(
          { label: 'all' },
          { $addToSet: { permissions: SUSPEND_STAFF } },
        );
    }
    await migration.down(db);
    await migration.down(db);
    for (const collection of COLLECTIONS) {
      const rows = await db
        .collection(collection)
        .find({})
        .sort({ label: 1 })
        .toArray();
      expect(
        rows.map(({ label, permissions }) => ({ label, permissions })),
      ).toEqual([
        { label: 'all', permissions: [UPDATE_ALL, SUSPEND_STAFF] },
        {
          label: 'existing',
          permissions: [UPDATE_ALL, UPDATE_STAFF, SUSPEND_ALL],
        },
        { label: 'reader', permissions: [READ_ALL] },
        { label: 'staff', permissions: [UPDATE_STAFF] },
      ]);
      expect(
        rows.some(
          (row) =>
            row.migrationMarkers?.suspendPermission20261016 !== undefined,
        ),
      ).toBe(false);
    }
  });
});

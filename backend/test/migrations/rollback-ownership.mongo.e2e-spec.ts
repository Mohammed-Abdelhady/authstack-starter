import { createRequire } from 'node:module';
import { MongoClient, ObjectId } from 'mongodb';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

interface Migration {
  up: (db: unknown) => Promise<void>;
  down: (db: unknown) => Promise<void>;
}

/** Shape the migration spec writes; the migrations themselves are untyped. */
interface LinkedAccountsUserDocument {
  googleId?: string;
  authProvider?: string;
  linkedAccounts?: Array<{
    provider: string;
    providerId: string;
    linkedAt: Date;
  }>;
}

// The migrations are plain CommonJS files the migration CLI loads by
// filename, so the spec loads them the same way instead of import-form.
const loadMigration = createRequire(__filename);
const defaultPermissions = loadMigration(
  '../../migrations/20260904000001-add-default-permissions-to-users.js',
) as Migration;
const linkedAccounts = loadMigration(
  '../../migrations/20260904000002-linked-accounts.js',
) as Migration;
const primaryProvider = loadMigration(
  '../../migrations/20260904000003-backfill-email-primary-provider.js',
) as Migration;

describe('migration rollback ownership', () => {
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

  it('should leave a pre-existing default permission intact across up then down', async () => {
    const users = client.db().collection('users');
    const ownedId = new ObjectId();
    const preexistingId = new ObjectId();
    await users.insertMany([
      { _id: ownedId, role: 'user', permissions: [] },
      {
        _id: preexistingId,
        role: 'user',
        permissions: ['profile:read:own', 'profile:update:own', 'custom:grant'],
      },
    ]);

    await defaultPermissions.up(client.db());
    await defaultPermissions.down(client.db());

    const preexisting = await users.findOne({ _id: preexistingId });
    expect(preexisting?.permissions).toEqual([
      'profile:read:own',
      'profile:update:own',
      'custom:grant',
    ]);
    const owned = await users.findOne({ _id: ownedId });
    expect(owned?.permissions ?? []).not.toContain('profile:read:own');
  });

  it('should refuse to roll back a non-legacy linked provider', async () => {
    const users = client.db().collection<LinkedAccountsUserDocument>('users');
    await users.insertOne({
      googleId: 'g-1',
      authProvider: 'google',
    });
    await linkedAccounts.up(client.db());
    await users.updateOne(
      { googleId: { $exists: false } },
      {
        $push: {
          linkedAccounts: {
            provider: 'microsoft',
            providerId: 'ms-1',
            linkedAt: new Date(),
          },
        },
      },
    );

    await expect(linkedAccounts.down(client.db())).rejects.toThrow(
      /legacy schema cannot store/,
    );
  });

  it('should restore only primaryProvider values this migration wrote', async () => {
    const users = client.db().collection('users');
    const ownedId = new ObjectId();
    const preexistingId = new ObjectId();
    await users.insertMany([
      { _id: ownedId, authProvider: 'email' },
      {
        _id: preexistingId,
        authProvider: 'email',
        primaryProvider: 'email',
      },
    ]);

    await primaryProvider.up(client.db());
    await users.updateOne(
      { _id: ownedId },
      { $set: { primaryProvider: 'google' } },
    );
    await primaryProvider.down(client.db());

    const owned = await users.findOne({ _id: ownedId });
    expect(owned?.primaryProvider).toBe('google');
    const preexisting = await users.findOne({ _id: preexistingId });
    expect(preexisting?.primaryProvider).toBe('email');
  });
});

import { BSON, Document, MongoClient, ObjectId } from 'mongodb';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { runMigrateMongo } from '../../../../test/migrations/migrate-mongo-cli';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';

interface MigrationConfig {
  changelogCollectionName: string;
}

const requireMigration = createRequire(__filename);
const migrationConfig = requireMigration(
  resolve(__dirname, '../../../../migrate-mongo-config.js'),
) as MigrationConfig;
const MIGRATION_FILE = '20261002000001-convert-string-objectid-references.js';
const OBJECT_ID_HEX = '507f1f77bcf86cd799439011';
const OTHER_OBJECT_ID_HEX = '507f1f77bcf86cd799439012';
const MALFORMED_OBJECT_ID = '507f1f77bcf86cd79943901z';
const TARGET_COLLECTIONS = ['passkeys', 'sessions'] as const;
const UNCHANGED_FIXTURE_KEYS = ['objectId', 'malformed', 'number', 'array'];
const GRANTS_COLLECTION = 'userapplicationgrants';
const THIRD_OBJECT_ID_HEX = '507f1f77bcf86cd799439013';
const WEB_CLIENT = 'web';
const MOBILE_CLIENT = 'mobile';

interface GrantFixture extends Document {
  fixtureCase: string;
  userId: ObjectId | string;
  clientId: string;
}

/** A partial earlier run: one row already converted, its string twin left behind. */
function createGrantFixtures(): GrantFixture[] {
  return [
    {
      _id: new ObjectId('507f1f77bcf86cd799439201'),
      fixtureCase: 'stringWithTwin',
      userId: OBJECT_ID_HEX,
      clientId: WEB_CLIENT,
    },
    {
      _id: new ObjectId('507f1f77bcf86cd799439202'),
      fixtureCase: 'twin',
      userId: new ObjectId(OBJECT_ID_HEX),
      clientId: WEB_CLIENT,
    },
    {
      _id: new ObjectId('507f1f77bcf86cd799439203'),
      fixtureCase: 'sameUserOtherClient',
      userId: OBJECT_ID_HEX,
      clientId: MOBILE_CLIENT,
    },
    {
      _id: new ObjectId('507f1f77bcf86cd799439204'),
      fixtureCase: 'stringAlone',
      userId: OTHER_OBJECT_ID_HEX,
      clientId: WEB_CLIENT,
    },
    {
      _id: new ObjectId('507f1f77bcf86cd799439205'),
      fixtureCase: 'alreadyConverted',
      userId: new ObjectId(THIRD_OBJECT_ID_HEX),
      clientId: WEB_CLIENT,
    },
    {
      _id: new ObjectId('507f1f77bcf86cd799439206'),
      fixtureCase: 'malformed',
      userId: MALFORMED_OBJECT_ID,
      clientId: WEB_CLIENT,
    },
  ];
}

async function readGrants(
  database: ReturnType<MongoClient['db']>,
): Promise<Record<string, string>> {
  const documents = await database
    .collection<GrantFixture>(GRANTS_COLLECTION)
    .find({})
    .toArray();
  return Object.fromEntries(
    documents.map(({ fixtureCase, userId, clientId }) => [
      fixtureCase,
      `${userId instanceof ObjectId ? 'ObjectId' : 'string'}:${String(userId)}:${clientId}`,
    ]),
  );
}

interface ReferenceFixture extends Document {
  fixtureCase: string;
  user?: ObjectId | string | number | string[];
  credentialId: string;
  tokenHash: string;
}

function createFixtures(): ReferenceFixture[] {
  return [
    {
      _id: new ObjectId('507f1f77bcf86cd799439101'),
      fixtureCase: 'valid',
      user: OBJECT_ID_HEX,
      credentialId: 'fixture-valid',
      tokenHash: 'fixture-valid',
    },
    {
      _id: new ObjectId('507f1f77bcf86cd799439102'),
      fixtureCase: 'objectId',
      user: new ObjectId(OTHER_OBJECT_ID_HEX),
      credentialId: 'fixture-objectid',
      tokenHash: 'fixture-objectid',
    },
    {
      _id: new ObjectId('507f1f77bcf86cd799439103'),
      fixtureCase: 'malformed',
      user: MALFORMED_OBJECT_ID,
      credentialId: 'fixture-malformed',
      tokenHash: 'fixture-malformed',
    },
    {
      _id: new ObjectId('507f1f77bcf86cd799439104'),
      fixtureCase: 'number',
      user: 42,
      credentialId: 'fixture-number',
      tokenHash: 'fixture-number',
    },
    {
      _id: new ObjectId('507f1f77bcf86cd799439105'),
      fixtureCase: 'array',
      user: [OBJECT_ID_HEX],
      credentialId: 'fixture-array',
      tokenHash: 'fixture-array',
    },
    {
      _id: new ObjectId('507f1f77bcf86cd799439106'),
      fixtureCase: 'missing',
      credentialId: 'fixture-missing',
      tokenHash: 'fixture-missing',
    },
  ];
}

describe('ObjectId reference data migration', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (mongo) {
      await mongo.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('converts only scalar valid ids and stays unchanged on a second run', async () => {
    if (!mongo) {
      throw new Error('expected a MongoDB replica set');
    }

    const databaseName = 'objectid_reference_migration';
    const mongoUri = mongo.uri(databaseName);
    const client = new MongoClient(mongoUri);
    await client.connect();
    const database = client.db(mongo.databaseName(databaseName));

    try {
      await database.dropDatabase();
      // Apply the full history before inserting the rows for this migration.
      await runMigrateMongo('up', mongoUri);

      const fixtures = createFixtures();
      for (const collectionName of TARGET_COLLECTIONS) {
        await database
          .collection<ReferenceFixture>(collectionName)
          .insertMany(fixtures);
      }

      const firstRun = await rerunReferenceMigration(database, mongoUri);

      for (const collectionName of TARGET_COLLECTIONS) {
        const documents = await readFixtures(database, collectionName);
        for (const fixtureKey of UNCHANGED_FIXTURE_KEYS) {
          const fixture = fixtures.find(
            ({ fixtureCase }) => fixtureCase === fixtureKey,
          );
          const stored = documents.get(fixtureKey);
          if (!fixture || !stored || fixture.user === undefined) {
            throw new Error(`missing ${fixtureKey} fixture`);
          }
          expect(BSON.serialize({ user: stored.user })).toEqual(
            BSON.serialize({ user: fixture.user }),
          );
        }

        const missing = documents.get('missing');
        expect(missing).toBeDefined();
        expect(missing && Object.hasOwn(missing, 'user')).toBe(false);

        const converted = documents.get('valid')?.user;
        expect(converted).toBeInstanceOf(ObjectId);
        if (!(converted instanceof ObjectId)) {
          throw new Error(`expected ${collectionName}.user to be an ObjectId`);
        }
        expect(converted.toHexString()).toBe(OBJECT_ID_HEX);
      }

      expect(firstRun).toContain('Converted 1 string ids in passkeys.user');
      expect(firstRun).toContain('Converted 1 string ids in sessions.user');

      const beforeSecondRun = await Promise.all(
        TARGET_COLLECTIONS.map(async (collectionName) =>
          [...(await readFixtures(database, collectionName)).entries()].map(
            ([fixtureKey, document]) =>
              [fixtureKey, BSON.serialize(document)] as const,
          ),
        ),
      );

      const secondRun = await rerunReferenceMigration(database, mongoUri);
      expect(secondRun).toContain('Converted 0 string ids in passkeys.user');
      expect(secondRun).toContain('Converted 0 string ids in sessions.user');

      const afterSecondRun = await Promise.all(
        TARGET_COLLECTIONS.map(async (collectionName) =>
          [...(await readFixtures(database, collectionName)).entries()].map(
            ([fixtureKey, document]) =>
              [fixtureKey, BSON.serialize(document)] as const,
          ),
        ),
      );
      expect(afterSecondRun).toEqual(beforeSecondRun);
    } finally {
      await database.dropDatabase();
      await client.close();
    }
  });

  it('drops a string grant whose ObjectId twin exists and can be re-run', async () => {
    if (!mongo) {
      throw new Error('expected a MongoDB replica set');
    }

    const databaseName = 'objectid_reference_twins';
    const mongoUri = mongo.uri(databaseName);
    const client = new MongoClient(mongoUri);
    await client.connect();
    const database = client.db(mongo.databaseName(databaseName));
    const converted = {
      twin: `ObjectId:${OBJECT_ID_HEX}:${WEB_CLIENT}`,
      sameUserOtherClient: `ObjectId:${OBJECT_ID_HEX}:${MOBILE_CLIENT}`,
      stringAlone: `ObjectId:${OTHER_OBJECT_ID_HEX}:${WEB_CLIENT}`,
      alreadyConverted: `ObjectId:${THIRD_OBJECT_ID_HEX}:${WEB_CLIENT}`,
      malformed: `string:${MALFORMED_OBJECT_ID}:${WEB_CLIENT}`,
    };

    try {
      await database.dropDatabase();
      await runMigrateMongo('up', mongoUri);
      await database
        .collection<GrantFixture>(GRANTS_COLLECTION)
        .insertMany(createGrantFixtures());

      await rerunReferenceMigration(database, mongoUri);

      expect(await readGrants(database)).toEqual(converted);

      await rerunReferenceMigration(database, mongoUri);

      expect(await readGrants(database)).toEqual(converted);
    } finally {
      await database.dropDatabase();
      await client.close();
    }
  });
});

async function rerunReferenceMigration(
  database: ReturnType<MongoClient['db']>,
  mongoUri: string,
): Promise<string> {
  // The CLI skips applied files, so remove only this marker to replay its up.
  const deleted = await database
    .collection(migrationConfig.changelogCollectionName)
    .deleteOne({ fileName: MIGRATION_FILE });
  expect(deleted.deletedCount).toBe(1);
  return runMigrateMongo('up', mongoUri);
}

async function readFixtures(
  database: ReturnType<MongoClient['db']>,
  collectionName: string,
): Promise<Map<string, ReferenceFixture>> {
  const documents = await database
    .collection<ReferenceFixture>(collectionName)
    .find({})
    .sort({ fixtureCase: 1 })
    .toArray();
  return new Map(documents.map((document) => [document.fixtureCase, document]));
}

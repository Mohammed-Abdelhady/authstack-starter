import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, extname, resolve } from 'node:path';
import type { Db, IndexDescription, MongoClient } from 'mongodb';
import { Connection } from 'mongoose';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { runMigrateMongo } from '../../../../test/migrations/migrate-mongo-cli';
import {
  bootSessionAuthority,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../../../test/utils/session-authority-harness';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { Application, ApplicationSchema } from './schemas/application.schema';
import { Session, SessionSchema } from './schemas/session.schema';
import {
  UserApplicationGrant,
  UserApplicationGrantSchema,
} from './schemas/user-application-grant.schema';
import {
  User,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import {
  Role,
  RoleSchema,
} from '../../../role/persistence/mongo/schemas/role.schema';

interface MigrationExports {
  up?: (database: Db, client: MongoClient) => Promise<void>;
  down?: (database: Db, client: MongoClient) => Promise<void>;
  default?: MigrationExports;
}

interface MigrationConfig {
  migrationFileExtension: string;
}

const requireMigration = createRequire(__filename);
const migrationDirectory = resolve(__dirname, '../../../../migrations');
const migrationConfig = requireMigration(
  resolve(__dirname, '../../../../migrate-mongo-config.js'),
) as MigrationConfig;

const EXPECTED_INDEXES = {
  sessions: [
    {
      name: 'expiresAt_1',
      keys: [['expiresAt', 1]],
      unique: false,
      sparse: false,
      expireAfterSeconds: 0,
    },
    {
      name: 'session_client_active',
      keys: [
        ['clientId', 1],
        ['isValid', 1],
      ],
      unique: false,
      sparse: false,
    },
    {
      name: 'session_user_active_created',
      keys: [
        ['user', 1],
        ['isValid', 1],
        ['createdAt', -1],
        ['_id', 1],
      ],
      unique: false,
      sparse: false,
    },
    {
      name: 'tokenHash_unique',
      keys: [['tokenHash', 1]],
      unique: true,
      sparse: false,
    },
    {
      name: 'user_1_lastUsedAt_-1',
      keys: [
        ['user', 1],
        ['lastUsedAt', -1],
      ],
      unique: false,
      sparse: false,
    },
  ],
  users: [
    {
      name: 'createdAt_-1',
      keys: [['createdAt', -1]],
      unique: false,
      sparse: false,
    },
    {
      name: 'email_1',
      keys: [['email', 1]],
      unique: true,
      sparse: false,
    },
    {
      name: 'isDeleted_1',
      keys: [['isDeleted', 1]],
      unique: false,
      sparse: false,
    },
    {
      name: 'linkedAccounts.provider_1_linkedAccounts.providerId_1',
      keys: [
        ['linkedAccounts.provider', 1],
        ['linkedAccounts.providerId', 1],
      ],
      unique: true,
      sparse: true,
    },
    {
      name: 'role_1',
      keys: [['role', 1]],
      unique: false,
      sparse: false,
    },
  ],
  applications: [
    {
      name: 'application_client_environment_unique',
      keys: [
        ['clientId', 1],
        ['environment', 1],
      ],
      unique: true,
      sparse: false,
    },
  ],
  grants: [
    {
      name: 'grant_user_client_unique',
      keys: [
        ['userId', 1],
        ['clientId', 1],
      ],
      unique: true,
      sparse: false,
    },
  ],
  roles: [
    {
      name: 'createdAt_-1',
      keys: [['createdAt', -1]],
      unique: false,
      sparse: false,
    },
    {
      name: 'isSystemRole_1',
      keys: [['isSystemRole', 1]],
      unique: false,
      sparse: false,
    },
    {
      name: 'slug_1',
      keys: [['slug', 1]],
      unique: true,
      sparse: false,
    },
  ],
};

/** Each runs the migration command in a child process. Slowest: 3.6 s. */
const MIGRATED_INDEXES_CASE_MS = 7_000;

describe('session authority migration indexes', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;
  let databaseSequence = 0;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('session_authority_indexes'),
      new FrozenClock(TEST_NOW),
    );
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (harness) {
      await harness.app.close();
    }
    if (mongo) {
      await mongo.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('exports up and down from every migration migrate-mongo discovers', async () => {
    const sampleMigration = `sample-migration${migrationConfig.migrationFileExtension}`;
    const filenames = (await readdir(migrationDirectory))
      .filter(
        (filename) =>
          extname(filename) === migrationConfig.migrationFileExtension &&
          basename(filename) !== sampleMigration,
      )
      .sort();
    const missingExports: string[] = [];

    for (const filename of filenames) {
      const loaded = requireMigration(
        resolve(migrationDirectory, filename),
      ) as MigrationExports;
      const migration = loaded.default ?? loaded;
      if (
        typeof migration.up !== 'function' ||
        typeof migration.down !== 'function'
      ) {
        missingExports.push(filename);
      }
    }

    expect(missingExports).toEqual([]);
  });

  it(
    'uses the same index contracts when migrations run before schemas',
    async () => {
      const { connection, mongoUri } = await freshDatabase();
      try {
        await runMigrateMongo('up', mongoUri);
        await createSchemaIndexes(connection);

        expect(await readIndexContracts(connection)).toEqual(EXPECTED_INDEXES);
      } finally {
        await connection.dropDatabase();
      }
    },
    MIGRATED_INDEXES_CASE_MS,
  );

  it(
    'uses the same index contracts when schemas run before migrations',
    async () => {
      const { connection, mongoUri } = await freshDatabase();
      try {
        await createSchemaIndexes(connection);
        await runMigrateMongo('up', mongoUri);

        expect(await readIndexContracts(connection)).toEqual(EXPECTED_INDEXES);
      } finally {
        await connection.dropDatabase();
      }
    },
    MIGRATED_INDEXES_CASE_MS,
  );

  it('keeps application and session records when rollback sees missing indexes', async () => {
    const { connection, mongoUri } = await freshDatabase();
    const database = requireDatabase(connection);
    try {
      await runMigrateMongo('up', mongoUri);
      await database.collection('sessions').insertOne({
        tokenHash: 'rollback-session-token',
        isValid: true,
      });
      await database
        .collection('applications')
        .dropIndex('application_client_environment_unique');
      await runMigrateMongo('down', mongoUri);
      await runMigrateMongo('down', mongoUri);

      expect({
        applications: await database
          .collection('applications')
          .countDocuments(),
        sessions: await database.collection('sessions').countDocuments(),
      }).toEqual({ applications: 6, sessions: 1 });
    } finally {
      await connection.dropDatabase();
    }
  });

  async function freshDatabase(): Promise<{
    connection: Connection;
    mongoUri: string;
  }> {
    databaseSequence += 1;
    const databaseName = `session_authority_indexes_${databaseSequence}`;
    const connection = harness.connection.useDb(
      mongo.databaseName(databaseName),
      {
        useCache: false,
      },
    );
    await connection.dropDatabase();
    return { connection, mongoUri: mongo.uri(databaseName) };
  }
});

async function createSchemaIndexes(connection: Connection): Promise<void> {
  await Promise.all([
    connection.model(Session.name, SessionSchema).createIndexes(),
    connection.model(Application.name, ApplicationSchema).createIndexes(),
    connection
      .model(UserApplicationGrant.name, UserApplicationGrantSchema)
      .createIndexes(),
    connection.model(User.name, UserSchema).createIndexes(),
    connection.model(Role.name, RoleSchema).createIndexes(),
  ]);
}

function requireDatabase(connection: Connection): Db {
  if (!connection.db) {
    throw new Error('expected a connected migration database');
  }
  return connection.db;
}

async function readIndexContracts(connection: Connection) {
  const database = requireDatabase(connection);
  const [sessions, applications, grants, users, roles] = await Promise.all([
    database.collection('sessions').indexes(),
    database.collection('applications').indexes(),
    database.collection('userapplicationgrants').indexes(),
    database.collection('users').indexes(),
    database.collection('roles').indexes(),
  ]);

  return {
    sessions: captureIndexes(sessions),
    users: captureIndexes(users),
    applications: captureIndexes(applications),
    grants: captureIndexes(grants),
    roles: captureIndexes(roles),
  };
}

function captureIndexes(indexes: IndexDescription[]) {
  return indexes
    .filter((index) => index.name !== '_id_')
    .map((index) => ({
      name: index.name ?? '',
      keys: Object.entries(index.key),
      unique: index.unique ?? false,
      sparse: index.sparse ?? false,
      ...(index.expireAfterSeconds === undefined
        ? {}
        : { expireAfterSeconds: index.expireAfterSeconds }),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Mongoose, Schema as MongooseSchema } from 'mongoose';
// feature:passkeys:start
import {
  Passkey,
  PasskeySchema,
} from '../../../auth/passkeys/persistence/mongo/schemas/passkey.schema';
import {
  PasskeyChallenge,
  PasskeyChallengeSchema,
} from '../../../auth/passkeys/persistence/mongo/schemas/passkey-challenge.schema';
// feature:passkeys:end
// feature:totp:start
import {
  TwoFactorChallenge,
  TwoFactorChallengeSchema,
} from '../../../auth/two-factor/persistence/mongo/schemas/two-factor-challenge.schema';
// feature:totp:end
import {
  AuthorizationTransaction,
  AuthorizationTransactionSchema,
} from '../../../session/persistence/mongo/schemas/authorization-transaction.schema';
import {
  NativeCredential,
  NativeCredentialSchema,
} from '../../../session/persistence/mongo/schemas/native-credential.schema';
import {
  Session,
  SessionSchema,
} from '../../../session/persistence/mongo/schemas/session.schema';
import {
  StepUpChallenge,
  StepUpChallengeSchema,
} from '../../../session/persistence/mongo/schemas/step-up-challenge.schema';
import {
  UserApplicationGrant,
  UserApplicationGrantSchema,
} from '../../../session/persistence/mongo/schemas/user-application-grant.schema';

interface MigrationReference {
  collection: string;
  field: string;
}

interface MigrationModule {
  OBJECT_ID_REFERENCES: MigrationReference[];
}

interface MigrationCollectionBinding extends MigrationReference {
  modelName: string;
  schemaName: string;
  schema: MongooseSchema;
}

interface LoadedSchema {
  exportName: string;
  schema: MongooseSchema;
}

const SOURCE_ROOT = resolve(__dirname, '../../..');

const OBJECT_ID_REFERENCES = [
  { schema: 'SessionSchema', path: 'user' },
  { schema: 'PasskeySchema', path: 'user' }, // feature:passkeys
  { schema: 'PasskeyChallengeSchema', path: 'user' }, // feature:passkeys
  { schema: 'TwoFactorChallengeSchema', path: 'user' }, // feature:totp
  { schema: 'UserApplicationGrantSchema', path: 'userId' },
  { schema: 'AuthorizationTransactionSchema', path: 'userId' },
  { schema: 'NativeCredentialSchema', path: 'sessionId' },
  { schema: 'StepUpChallengeSchema', path: 'sessionId' },
  { schema: 'StepUpChallengeSchema', path: 'userId' },
] as const;

// Keep all migration references even when optional schemas are pruned.
const EXPECTED_MIGRATION_REFERENCE_KEYS = [
  'sessions.user',
  'passkeys.user',
  'passkeychallenges.user',
  'twofactorchallenges.user',
  'userapplicationgrants.userId',
  'authorizationtransactions.userId',
  'nativecredentials.sessionId',
  'stepupchallenges.sessionId',
  'stepupchallenges.userId',
].sort();

const MIGRATION_COLLECTION_BINDINGS: MigrationCollectionBinding[] = [
  {
    collection: 'sessions',
    field: 'user',
    modelName: Session.name,
    schemaName: 'SessionSchema',
    schema: SessionSchema,
  },
  // feature:passkeys:start
  {
    collection: 'passkeys',
    field: 'user',
    modelName: Passkey.name,
    schemaName: 'PasskeySchema',
    schema: PasskeySchema,
  },
  // feature:passkeys:end
  // feature:passkeys:start
  {
    collection: 'passkeychallenges',
    field: 'user',
    modelName: PasskeyChallenge.name,
    schemaName: 'PasskeyChallengeSchema',
    schema: PasskeyChallengeSchema,
  },
  // feature:passkeys:end
  // feature:totp:start
  {
    collection: 'twofactorchallenges',
    field: 'user',
    modelName: TwoFactorChallenge.name,
    schemaName: 'TwoFactorChallengeSchema',
    schema: TwoFactorChallengeSchema,
  },
  // feature:totp:end
  {
    collection: 'userapplicationgrants',
    field: 'userId',
    modelName: UserApplicationGrant.name,
    schemaName: 'UserApplicationGrantSchema',
    schema: UserApplicationGrantSchema,
  },
  {
    collection: 'authorizationtransactions',
    field: 'userId',
    modelName: AuthorizationTransaction.name,
    schemaName: 'AuthorizationTransactionSchema',
    schema: AuthorizationTransactionSchema,
  },
  {
    collection: 'nativecredentials',
    field: 'sessionId',
    modelName: NativeCredential.name,
    schemaName: 'NativeCredentialSchema',
    schema: NativeCredentialSchema,
  },
  {
    collection: 'stepupchallenges',
    field: 'sessionId',
    modelName: StepUpChallenge.name,
    schemaName: 'StepUpChallengeSchema',
    schema: StepUpChallengeSchema,
  },
  {
    collection: 'stepupchallenges',
    field: 'userId',
    modelName: StepUpChallenge.name,
    schemaName: 'StepUpChallengeSchema',
    schema: StepUpChallengeSchema,
  },
];

const migration = jest.requireActual<MigrationModule>(
  resolve(
    __dirname,
    '../../../../migrations/20261002000001-convert-string-objectid-references.js',
  ),
);

const ALLOWED_MIXED_PATHS: Record<string, string> = {
  'SessionSchema.device':
    'DeviceInfo lacks @Schema; preserve its existing Mixed shape.',
};

function schemaFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = join(directory, entry.name);
      return entry.isDirectory()
        ? schemaFiles(file)
        : file.endsWith('.schema.ts')
          ? [file]
          : [];
    })
    .sort();
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function loadSchemas(files: string[]): LoadedSchema[] {
  return files.flatMap((file) => {
    const moduleExports: unknown = jest.requireActual<object>(file);
    if (!isObjectRecord(moduleExports)) {
      return [];
    }

    return Object.entries(moduleExports).flatMap(([exportName, value]) =>
      value instanceof MongooseSchema ? [{ exportName, schema: value }] : [],
    );
  });
}

function mixedPaths(schemas: LoadedSchema[]): string[] {
  const matches = new Set<string>();

  function inspect(
    schema: MongooseSchema,
    label: string,
    ancestors: Set<MongooseSchema>,
  ): void {
    if (ancestors.has(schema)) {
      return;
    }
    const nestedAncestors = new Set(ancestors);
    nestedAncestors.add(schema);

    schema.eachPath((pathName, pathType) => {
      if (
        pathType.instance === 'Mixed' ||
        pathType.getEmbeddedSchemaType()?.instance === 'Mixed'
      ) {
        matches.add(`${label}.${pathName}`);
      }
      if (pathType.schema) {
        inspect(pathType.schema, `${label}.${pathName}`, nestedAncestors);
      }
    });
  }

  for (const { exportName, schema } of schemas) {
    inspect(schema, exportName, new Set());
  }

  return [...matches].sort();
}

const schemas = loadSchemas(schemaFiles(SOURCE_ROOT));

describe('ObjectId reference schema types', () => {
  it.each(OBJECT_ID_REFERENCES)(
    '$schema.$path uses ObjectId casting',
    ({ schema: schemaName, path }) => {
      const definition = schemas.find(
        ({ exportName }) => exportName === schemaName,
      );
      const pathType = definition?.schema.path(path);
      const instance =
        pathType?.getEmbeddedSchemaType()?.instance ?? pathType?.instance;

      expect(instance).toBe('ObjectId');
    },
  );

  it('finds only documented Mixed paths', () => {
    expect(mixedPaths(schemas)).toEqual(
      Object.keys(ALLOWED_MIXED_PATHS).sort(),
    );
  });

  it('keeps every migration field and binds available schemas to collections', () => {
    const actualKeys = migration.OBJECT_ID_REFERENCES.map(
      ({ collection, field }) => `${collection}.${field}`,
    ).sort();

    expect(actualKeys).toEqual(EXPECTED_MIGRATION_REFERENCE_KEYS);

    const expectedSchemaPaths = OBJECT_ID_REFERENCES.map(
      ({ schema, path }) => `${schema}.${path}`,
    ).sort();
    const boundSchemaPaths = MIGRATION_COLLECTION_BINDINGS.map(
      ({ schemaName, field }) => `${schemaName}.${field}`,
    ).sort();
    expect(boundSchemaPaths).toEqual(expectedSchemaPaths);

    for (const binding of MIGRATION_COLLECTION_BINDINGS) {
      const model = new Mongoose().model(binding.modelName, binding.schema);
      expect(binding.collection).toBe(model.collection.name);
      expect(actualKeys).toContain(`${binding.collection}.${binding.field}`);
    }
  });
});

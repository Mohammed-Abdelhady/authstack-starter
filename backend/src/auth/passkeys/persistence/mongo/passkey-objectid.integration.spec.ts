import { browserApplicationsForTest } from '../../../../common/testing/browser-applications.harness-spec';
import { ConfigService } from '@nestjs/config';
import { Document, MongoClient, ObjectId } from 'mongodb';
import {
  request as expressRequest,
  response as expressResponse,
  Response,
} from 'express';
import { Mongoose, Types } from 'mongoose';
import { AuthFeaturesService } from '../../../services/features/auth-features.service';
import {
  User,
  UserDocument,
  UserSchema,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { PASSKEY_CHALLENGE_COOKIE } from '../../constants/passkeys.constants';
import {
  Passkey,
  PasskeyDocument,
  PasskeySchema,
} from './schemas/passkey.schema';
import {
  PasskeyChallenge,
  PasskeyChallengeDocument,
  PasskeyChallengeSchema,
} from './schemas/passkey-challenge.schema';
import { VerifyPasskeyRegistrationDto } from '../../dto/verify-passkey-registration.dto';
import { PasskeyChallengeService } from '../../services/passkey-challenge.service';
import { MongoPasskeyAccounts } from './mongo-passkey-accounts';
import { MongoPasskeyChallengeStore } from './mongo-passkey-challenge.store';
import { MongoPasskeyStore } from './mongo-passkey.store';
import { MongoUnitOfWorkRunner } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { MongoSignInMethodStore } from '../../../../user/persistence/mongo/mongo-sign-in-method.store';
import { SignInMethodRule } from '../../../../user/services/sign-in-method.rule';
import { PasskeyConfigService } from '../../services/passkey-config.service';
import { PasskeyManagementService } from '../../services/passkey-management.service';
import { PasskeyRegistrationReauth } from '../../services/passkey-registration-reauth.service';
import {
  PasskeyRegistrationService,
  SignedInRequest,
} from '../../services/passkey-registration.service';
import { partialMock } from '../../../../common/testing/test-doubles.harness-spec';
import { PasskeyRecorder } from '../../services/passkey-recorder.service';
import { NoEnrolmentPromotion } from '../../services/enrolment-promotion';
import {
  AttestationVerification,
  WebAuthnAdapter,
} from '../../services/webauthn.adapter';
import { startMemoryReplSet } from '../../../../../test/utils/memory-replset';
import { runMigrateMongo } from '../../../../../test/migrations/migrate-mongo-cli';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/utils/session-authority-harness';

const TEST_CONFIGURATION = {
  oauth: { stateSecret: 'passkey-objectid-test-secret-value' },
  passkeys: {
    rpId: 'localhost',
    rpName: 'Test application',
    origin: 'http://localhost:3000',
  },
  auth: { passwordEnabled: true },
};
const ATTESTATION: AttestationVerification = {
  credentialId: 'round-trip-credential',
  publicKey: Buffer.from([1, 2, 3]),
  counter: 0,
  transports: ['internal'],
  deviceType: 'multiDevice',
  backedUp: true,
  userVerified: false,
};
const LEGACY_PASSKEY_ID = new ObjectId('507f1f77bcf86cd799439201');
const REGISTERED_USER_ID = '507f1f77bcf86cd799439211';
const LEGACY_USER_ID = '507f1f77bcf86cd799439212';
const LEGACY_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

interface RawPasskey extends Document {
  _id: ObjectId;
  user?: unknown;
  credentialId: string;
  publicKey: Buffer;
  counter: number;
  transports: string[];
  backedUp: boolean;
  name: string;
  lastUsedAt: Date | null;
}

/**
 * The case connects twice, builds the indexes of three collections and runs
 * the migration command in a child process. Slowest measured: 4.9 seconds.
 */
const MIGRATED_ROUND_TRIP_CASE_MS = 10_000;

describe('passkey ObjectId round trip', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (mongo) {
      await mongo.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it(
    'stores registration ids as ObjectIds and repairs legacy passkeys',
    async () => {
      if (!mongo) {
        throw new Error('expected a MongoDB replica set');
      }

      const databaseName = 'passkey_objectid_round_trip';
      const mongoUri = mongo.uri(databaseName);
      const rawClient = new MongoClient(mongoUri);
      await rawClient.connect();
      const database = rawClient.db(mongo.databaseName(databaseName));
      const mongoose = new Mongoose();
      const connection = await mongoose.createConnection(mongoUri).asPromise();

      try {
        connection.model(Passkey.name, PasskeySchema);
        connection.model(PasskeyChallenge.name, PasskeyChallengeSchema);
        connection.model(User.name, UserSchema);
        const passkeys = connection.model<PasskeyDocument>(Passkey.name);
        const challenges = connection.model<PasskeyChallengeDocument>(
          PasskeyChallenge.name,
        );
        const users = connection.model<UserDocument>(User.name);
        await Promise.all([
          passkeys.createIndexes(),
          challenges.createIndexes(),
          users.createIndexes(),
        ]);

        const config = new ConfigService(TEST_CONFIGURATION);
        const browserApplications = browserApplicationsForTest(config);
        const challengeService = new PasskeyChallengeService(
          new MongoPasskeyChallengeStore(challenges),
          config,
        );
        const adapter = new WebAuthnAdapter();
        jest.spyOn(adapter, 'verifyAttestation').mockResolvedValue(ATTESTATION);
        const registration = new PasskeyRegistrationService(
          new MongoPasskeyStore(passkeys),
          new MongoPasskeyAccounts(users),
          adapter,
          new PasskeyConfigService(config),
          challengeService,
          // The proof asked before a passkey is added has its own cases.
          partialMock<PasskeyRegistrationReauth>({}),
          new PasskeyRecorder(
            new MongoPasskeyStore(passkeys),
            new MongoPasskeyAccounts(users),
            new MongoUnitOfWorkRunner(connection),
            new NoEnrolmentPromotion(),
          ),
        );
        const management = new PasskeyManagementService(
          new MongoPasskeyStore(passkeys),
          new SignInMethodRule(
            new MongoSignInMethodStore(users, passkeys),
            new AuthFeaturesService(config, browserApplications),
          ),
          new MongoUnitOfWorkRunner(connection),
          new PasskeyConfigService(config),
        );

        await users.create({
          _id: new Types.ObjectId(REGISTERED_USER_ID),
          email: 'registered-passkey@example.test',
          name: 'Registered user',
          role: 'user',
        });
        const registeredUserId = REGISTERED_USER_ID;
        const issued = createResponse();
        await challengeService.issue(
          issued.response,
          'register',
          'round-trip-challenge',
          registeredUserId,
          ROUND_TRIP_SESSION.id,
        );
        const request = createRequest({
          [PASSKEY_CHALLENGE_COOKIE]: issued.cookies[PASSKEY_CHALLENGE_COOKIE],
        });
        const dto: VerifyPasskeyRegistrationDto = {
          response: {
            id: 'round-trip-credential',
            rawId: 'round-trip-credential',
            response: {},
            clientExtensionResults: {},
            type: 'public-key',
          },
          name: 'Registered key',
        };

        const created = await registration.verify(
          registeredUserId,
          dto,
          request,
          issued.response,
        );
        const rawPasskeys = database.collection<RawPasskey>('passkeys');
        const stored = await rawPasskeys.findOne({
          credentialId: ATTESTATION.credentialId,
        });
        const storedUser = stored?.user;
        const storedUserIsObjectId = storedUser instanceof ObjectId;
        const storedUserHex =
          storedUser instanceof ObjectId ? storedUser.toHexString() : null;

        const listed = await management.list(registeredUserId.toUpperCase());

        await users.create({
          _id: new Types.ObjectId(LEGACY_USER_ID),
          email: 'legacy-passkey@example.test',
          name: 'Legacy user',
          role: 'user',
        });
        const legacyUserId = LEGACY_USER_ID;
        await rawPasskeys.insertOne({
          _id: LEGACY_PASSKEY_ID,
          user: legacyUserId,
          credentialId: 'legacy-passkey-credential',
          publicKey: Buffer.from([4, 5, 6]),
          counter: 1,
          transports: ['internal'],
          backedUp: false,
          name: 'Legacy key',
          lastUsedAt: null,
          createdAt: LEGACY_CREATED_AT,
          updatedAt: LEGACY_CREATED_AT,
        });

        const legacyBeforeMigration = await management.list(legacyUserId);
        const migrationOutput = await runMigrateMongo('up', mongoUri);
        const legacyAfterMigration = await management.list(legacyUserId);

        expect({
          storedUserIsObjectId,
          storedUserHex,
          registrationFoundByStringId: listed.data.passkeys.some(
            ({ id }) => id === created.data.id,
          ),
          legacyIdsBeforeMigration: legacyBeforeMigration.data.passkeys.map(
            ({ id }) => id,
          ),
          migrationReportedOneLegacyPasskey: migrationOutput.includes(
            'Converted 1 string ids in passkeys.user',
          ),
          legacyIdsAfterMigration: legacyAfterMigration.data.passkeys.map(
            ({ id }) => id,
          ),
        }).toEqual({
          storedUserIsObjectId: true,
          storedUserHex: REGISTERED_USER_ID,
          registrationFoundByStringId: true,
          legacyIdsBeforeMigration: [],
          migrationReportedOneLegacyPasskey: true,
          legacyIdsAfterMigration: ['507f1f77bcf86cd799439201'],
        });
      } finally {
        await database.dropDatabase();
        await connection.close();
        await rawClient.close();
      }
    },
    MIGRATED_ROUND_TRIP_CASE_MS,
  );
});

function createResponse(): {
  response: Response;
  cookies: Record<string, string>;
} {
  const cookies: Record<string, string> = {};
  const response = new Proxy(expressResponse, {
    get(target, property, receiver): unknown {
      if (property === 'cookie') {
        return (name: string, value: string): void => {
          cookies[name] = value;
        };
      }
      if (property === 'clearCookie') {
        return (): void => undefined;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { response, cookies };
}

/** The session the round-trip challenge is issued to and answered on. */
const ROUND_TRIP_SESSION = {
  id: 'round-trip-session',
  createdAt: new Date(0),
  clientId: 'web',
};

function createRequest(cookies: Record<string, string>): SignedInRequest {
  return new Proxy(expressRequest, {
    get(target, property, receiver): unknown {
      if (property === 'cookies') {
        return cookies;
      }
      if (property === 'session') {
        return ROUND_TRIP_SESSION;
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

import { Connection, createConnection, Model } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../test/utils/memory-replset';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import { MongoUnitOfWorkRunner } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { SecurityEventService } from '../../../session/persistence/mongo/security-event.service';
import { MongoSessionRevocationStore } from '../../../session/persistence/mongo/mongo-session-revocation.store';
import {
  SecurityEvent,
  SecurityEventDocument,
  SecurityEventSchema,
} from '../../../session/persistence/mongo/schemas/security-event.schema';
import {
  Session,
  SessionDocument,
  SessionSchema,
} from '../../../session/persistence/mongo/schemas/session.schema';
import {
  User,
  UserDocument,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { MongoPasswordSignInStore } from './mongo-password-sign-in.store';
import { ACCOUNT_VERSION_ADVANCE } from '../../../session/revocation/session-revocation.store';

const OLD_PASSWORD_HASH = 'old-password-hash';
const NEW_PASSWORD_HASH = 'new-password-hash';

type LegacyVersion = 'missing' | 'null' | number;

async function storePasswordAndAdvanceVersion(
  runner: MongoUnitOfWorkRunner,
  passwords: MongoPasswordSignInStore,
  revocations: MongoSessionRevocationStore,
  userId: string,
  expectedVersion: number,
): Promise<{ passwordChanged: boolean; versionAdvanced: boolean }> {
  return runner.run(async (unitOfWork) => {
    const passwordChanged = await passwords.storeNewPasswordIn(
      unitOfWork,
      userId,
      expectedVersion,
      NEW_PASSWORD_HASH,
    );
    if (!passwordChanged) {
      return { passwordChanged, versionAdvanced: false };
    }
    const advanced = await revocations.advanceAccountVersionFrom(
      unitOfWork,
      userId,
      expectedVersion,
    );
    if (advanced !== ACCOUNT_VERSION_ADVANCE.ADVANCED) {
      throw new Error('account version did not advance after password write');
    }
    return {
      passwordChanged,
      versionAdvanced: true,
    };
  });
}

describe('Mongo native reset account version writes', () => {
  let mongo: MemoryReplSet | undefined;
  let connection: Connection | undefined;
  let users: Model<UserDocument>;
  let passwords: MongoPasswordSignInStore;
  let revocations: MongoSessionRevocationStore;
  let runner: MongoUnitOfWorkRunner;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.getUri()).asPromise();
    connection.model(User.name, UserSchema);
    connection.model(Session.name, SessionSchema);
    connection.model(SecurityEvent.name, SecurityEventSchema);
    const userModel = connection.model<UserDocument>(User.name);
    const sessionModel = connection.model<SessionDocument>(Session.name);
    const eventModel = connection.model<SecurityEventDocument>(
      SecurityEvent.name,
    );
    users = userModel;
    await Promise.all([
      userModel.init(),
      sessionModel.init(),
      eventModel.init(),
    ]);
    const clock = new FrozenClock(TEST_NOW);
    passwords = new MongoPasswordSignInStore(userModel);
    revocations = new MongoSessionRevocationStore(
      sessionModel,
      userModel,
      new SecurityEventService(eventModel, clock),
    );
    runner = new MongoUnitOfWorkRunner(connection);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await users.deleteMany({});
  });

  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function seedAccount(
    email: string,
    version: LegacyVersion,
  ): Promise<string> {
    if (!connection) throw new Error('the MongoDB connection did not open');
    const account = await users.create({
      email,
      name: 'Reset Target',
      password: OLD_PASSWORD_HASH,
      isVerified: true,
      sessionVersion: typeof version === 'number' ? version : 0,
    });
    if (version === 'missing') {
      await connection
        .collection('users')
        .updateOne({ _id: account._id }, { $unset: { sessionVersion: '' } });
    } else if (version === 'null') {
      await connection
        .collection('users')
        .updateOne({ _id: account._id }, { $set: { sessionVersion: null } });
    }
    return account._id.toString();
  }

  it.each(['missing', 'null'] as const)(
    'updates password and advances an account with a %s version as canonical zero',
    async (version) => {
      const userId = await seedAccount(
        `legacy-${version}@example.test`,
        version,
      );

      const result = await storePasswordAndAdvanceVersion(
        runner,
        passwords,
        revocations,
        userId,
        0,
      );
      const stored = await users.findById(userId).select('+password').exec();

      expect(result).toEqual({ passwordChanged: true, versionAdvanced: true });
      expect(stored?.password).toBe(NEW_PASSWORD_HASH);
      expect(stored?.sessionVersion).toBe(1);
    },
  );

  it('keeps positive versions exact for password writes and authority advancement', async () => {
    const userId = await seedAccount('versioned@example.test', 7);

    const stale = await storePasswordAndAdvanceVersion(
      runner,
      passwords,
      revocations,
      userId,
      6,
    );
    const untouched = await users.findById(userId).select('+password').exec();
    const current = await storePasswordAndAdvanceVersion(
      runner,
      passwords,
      revocations,
      userId,
      7,
    );
    const advanced = await users.findById(userId).select('+password').exec();

    expect(stale).toEqual({ passwordChanged: false, versionAdvanced: false });
    expect(untouched?.password).toBe(OLD_PASSWORD_HASH);
    expect(untouched?.sessionVersion).toBe(7);
    expect(current).toEqual({ passwordChanged: true, versionAdvanced: true });
    expect(advanced?.password).toBe(NEW_PASSWORD_HASH);
    expect(advanced?.sessionVersion).toBe(8);
  });
});

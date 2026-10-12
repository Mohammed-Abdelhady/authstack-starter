import * as bcrypt from 'bcrypt';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { ErrorCode } from '../../../../common/enums/error-code.enum';
// feature:passkeys:start
import {
  Passkey,
  PasskeySchema,
} from '../../../../auth/passkeys/persistence/mongo/schemas/passkey.schema';
// feature:passkeys:end
import {
  Role,
  RoleSchema,
} from '../../../../role/persistence/mongo/schemas/role.schema';
import { SessionRevoker } from '../../../../session/revocation/session-revoker';
import { User } from '../schemas/user.schema';
import { Clock } from '../../../../common/services/clock';
import { HashService } from '../../../../common/services/hash.service';
import { ConfigService } from '@nestjs/config';
import { UserProfileService } from '../../../services/user-profile.service';
import { hashToken } from '../../../../session/utils/hashing/token-hash';
import { startMemoryReplSet } from '../../../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  type SessionAuthorityHarness,
} from '../../../../../test/utils/session-authority-harness';
import { UnitOfWorkRunner } from '../../../../common/persistence/unit-of-work';
import { MongoUnitOfWorkRunner } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { MONGO_ACCOUNT_STORES } from '../mongo-account-stores';
import { MailDispatcherService } from '../../../../mail/mail-dispatcher.service';
import {
  securityNoticeProviders,
  stubSmtpBoundary,
} from '../../../../../test/utils/security-notice-fixture';

const OLD_PASSWORD = 'OldPassword123!';
const NEW_PASSWORD = 'NewPassword123!';

describe('password change keeps the calling session (plan S1)', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;
  let service: UserProfileService;
  let module: TestingModule | undefined;
  let restoreSmtp: (() => void) | undefined;

  beforeAll(async () => {
    restoreSmtp = stubSmtpBoundary();
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('user_password'),
      new FrozenClock(TEST_NOW),
    );
    module = await Test.createTestingModule({
      providers: [
        UserProfileService,
        {
          provide: HashService,
          useValue: new HashService(
            new ConfigService({ bcrypt: { rounds: 4 } }),
          ),
        },
        ...MONGO_ACCOUNT_STORES,
        { provide: UnitOfWorkRunner, useClass: MongoUnitOfWorkRunner },
        { provide: Clock, useValue: harness.clock },
        { provide: getModelToken(User.name), useValue: harness.users },
        {
          provide: getModelToken(Role.name),
          inject: [getConnectionToken()],
          useFactory: (connection: Connection): Model<Role> =>
            connection.model(Role.name, RoleSchema),
        },
        // feature:passkeys:start
        {
          provide: getModelToken(Passkey.name),
          inject: [getConnectionToken()],
          useFactory: (connection: Connection): Model<Passkey> =>
            connection.model(Passkey.name, PasskeySchema),
        },
        // feature:passkeys:end
        { provide: SessionRevoker, useValue: harness.app.get(SessionRevoker) },
        { provide: getConnectionToken(), useValue: harness.connection },
        ...securityNoticeProviders(),
      ],
    }).compile();
    await module.get<Model<Role>>(getModelToken(Role.name)).init();
    // feature:passkeys:start
    await module.get<Model<Passkey>>(getModelToken(Passkey.name)).init();
    // feature:passkeys:end
    service = module.get(UserProfileService);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterEach(async () => {
    await module?.get(MailDispatcherService).flush();
  });

  afterAll(async () => {
    try {
      await module?.get(MailDispatcherService).flush();
      await module?.close();
      await harness?.app.close();
    } finally {
      restoreSmtp?.();
      await mongo?.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    harness.clock.set(TEST_NOW);
    await harness.sessions.deleteMany({});
    await harness.users.deleteMany({});
  });

  async function seedUserWithPassword(email: string): Promise<{
    userId: string;
  }> {
    const user = await harness.users.create({
      email,
      name: 'Password User',
      role: 'user',
      password: await bcrypt.hash(OLD_PASSWORD, 4),
      isVerified: true,
      sessionVersion: 0,
    });
    return { userId: user._id.toString() };
  }

  async function sessionIdFor(token: string): Promise<string> {
    const session = await harness.sessions.findOne({
      tokenHash: hashToken(token),
    });
    if (!session) {
      throw new Error('expected session');
    }
    return session._id.toString();
  }

  async function userObjectId(userId: string): Promise<Types.ObjectId> {
    const user = await harness.users.findById(userId).exec();
    if (!user) {
      throw new Error('expected user');
    }
    return user._id;
  }

  it('changes the password and keeps only the calling session', async () => {
    const { userId } = await seedUserWithPassword('password@example.test');
    const objectId = await userObjectId(userId);
    const current = await harness.sessionService.createSession(
      objectId,
      'current',
      '127.0.0.1',
    );
    const other = await harness.sessionService.createSession(
      objectId,
      'other',
      '127.0.0.1',
    );

    const result = await service.changePassword(
      userId,
      { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
      await sessionIdFor(current.sessionToken),
    );

    expect(result).toEqual({
      success: true,
      data: {
        message:
          'Password changed successfully. Other sessions have been logged out.',
      },
    });
    const user = await harness.users
      .findById(userId)
      .select('+password')
      .exec();
    expect(await bcrypt.compare(NEW_PASSWORD, user?.password ?? '')).toBe(true);
    expect(bcrypt.getRounds(user?.password ?? '')).toBe(4);
    expect(await bcrypt.compare(OLD_PASSWORD, user?.password ?? '')).toBe(
      false,
    );
    expect(
      await harness.sessionService.validateSession(current.sessionToken),
    ).not.toBeNull();
    expect(
      await harness.sessionService.validateSession(other.sessionToken),
    ).toBeNull();
  });

  it('leaves the old password in place when the revocation fails', async () => {
    const { userId } = await seedUserWithPassword('atomic@example.test');
    const current = await harness.sessionService.createSession(
      await userObjectId(userId),
      'current',
      '127.0.0.1',
    );
    const currentId = await sessionIdFor(current.sessionToken);
    await harness.sessions.updateOne(
      { _id: currentId },
      { $set: { isValid: false, revokedAt: TEST_NOW } },
    );

    await expect(
      service.changePassword(
        userId,
        { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
        currentId,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID });

    const user = await harness.users
      .findById(userId)
      .select('+password')
      .exec();
    expect(await bcrypt.compare(OLD_PASSWORD, user?.password ?? '')).toBe(true);
    expect(await bcrypt.compare(NEW_PASSWORD, user?.password ?? '')).toBe(
      false,
    );
  });

  it('refuses without a current session and changes nothing', async () => {
    const { userId } = await seedUserWithPassword('nosession@example.test');

    await expect(
      service.changePassword(
        userId,
        { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
        null,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID });

    const user = await harness.users
      .findById(userId)
      .select('+password')
      .exec();
    expect(await bcrypt.compare(OLD_PASSWORD, user?.password ?? '')).toBe(true);
  });
});

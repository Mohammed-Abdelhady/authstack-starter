import { AudiencePolicy } from '../../../../../session/applications/audience-policy';
import { AdminAudienceScopes } from '../../../../services/users/admin-audience-scopes';
import { MongoRoleChangeStore } from '../../../../../role/persistence/mongo/mongo-role-change.store';
import { SecurityEventService } from '../../../../../session/persistence/mongo/security-event.service';
import {
  SecurityEvent,
  SecurityEventDocument,
  SecurityEventSchema,
} from '../../../../../session/persistence/mongo/schemas/security-event.schema';
import { ConfigService } from '@nestjs/config';
import { Connection, Model, createConnection } from 'mongoose';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import { partialMock } from '../../../../../common/testing/test-doubles.harness-spec';
import { MongoAddressLedger } from '../../../../../common/persistence/mongo/mongo-address-ledger';
import {
  AddressClaim,
  AddressClaimDocument,
  AddressClaimSchema,
} from '../../../../../common/persistence/mongo/schemas/address-claim.schema';
import { MongoUnitOfWorkRunner } from '../../../../../session/persistence/mongo/mongo-unit-of-work';
import {
  PendingRegistration,
  PendingRegistrationDocument,
  PendingRegistrationSchema,
} from '../../../../../auth/persistence/mongo/schemas/pending-registration.schema';
import {
  MailCounter,
  MailCounterDocument,
  MailCounterSchema,
} from '../../../../../auth/persistence/mongo/schemas/mail-counter.schema';
import { MongoPendingRegistrationStore } from '../../../../../auth/persistence/mongo/mongo-pending-registration.store';
import { MongoMailCounterStore } from '../../../../../auth/persistence/mongo/mongo-mail-counter.store';
import { MailCounterService } from '../../../../../auth/services/mail/mail-counter.service';
import { HashService } from '../../../../../common/services/hash.service';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../../../test/utils/memory-replset';
import { AdminEmailChangeService } from '../../../../services/users/admin-email-change.service';
import { VerificationCodeService } from '../../../../../auth/services/codes/verification-code.service';
import { AuthMailService } from '../../../../../auth/services/mail/auth-mail.service';
import {
  User,
  UserDocument,
  UserSchema,
} from '../../../../../user/persistence/mongo/schemas/user.schema';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { PENDING_PURPOSE } from '../../../../../auth/constants/registration';
import {
  Role,
  RoleDocument,
  RoleSchema,
} from '../../../../../role/persistence/mongo/schemas/role.schema';
import { toStoredAccount } from '../../../../../user/persistence/mongo/mongo-account-records';
import { MongoAdminAccountStore } from '../../mongo-admin-account.store';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';

describe('AdminEmailChangeService', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let users: Model<UserDocument>;
  let service: AdminEmailChangeService;

  const mockAuthMailService = {
    sendEmailChangeCode: jest.fn().mockResolvedValue(true),
  };

  const config = new ConfigService({
    activation: { codeExpiresIn: 900000, maxAttempts: 5 },
    bcrypt: { rounds: 4 },
  });
  const clock = new FrozenClock(TEST_NOW);
  let codes: Model<PendingRegistrationDocument>;
  let counters: Model<MailCounterDocument>;
  let claims: Model<AddressClaimDocument>;
  let mailCounter: MailCounterService;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.getUri()).asPromise();
    connection.model(User.name, UserSchema);
    connection.model(Role.name, RoleSchema);
    connection.model(PendingRegistration.name, PendingRegistrationSchema);
    connection.model(MailCounter.name, MailCounterSchema);
    connection.model(AddressClaim.name, AddressClaimSchema);
    connection.model(SecurityEvent.name, SecurityEventSchema);
    users = connection.model<UserDocument>(User.name);
    codes = connection.model<PendingRegistrationDocument>(
      PendingRegistration.name,
    );
    counters = connection.model<MailCounterDocument>(MailCounter.name);
    claims = connection.model<AddressClaimDocument>(AddressClaim.name);
    await Promise.all([
      users.init(),
      codes.init(),
      counters.init(),
      claims.init(),
    ]);
    mailCounter = new MailCounterService(
      new MongoMailCounterStore(counters),
      config,
      clock,
    );
    const verification = new VerificationCodeService(
      new MongoPendingRegistrationStore(codes, counters),
      new HashService(config),
      config,
      clock,
      mailCounter,
    );
    service = new AdminEmailChangeService(
      new MongoAdminAccountStore(
        users,
        connection.model<RoleDocument>(Role.name),
      ),
      verification,
      partialMock<AuthMailService>(mockAuthMailService),
      config,
      new MongoAddressLedger(claims, users),
      new MongoUnitOfWorkRunner(connection),
      clock,
      new AdminAudienceScopes(
        new AudiencePolicy(config),
        new MongoRoleChangeStore(
          connection.model<RoleDocument>(Role.name),
          users,
          new SecurityEventService(
            connection.model<SecurityEventDocument>(SecurityEvent.name),
            clock,
          ),
        ),
      ),
    );
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection.close();
    await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    jest.clearAllMocks();
    clock.set(TEST_NOW);
    await Promise.all([
      users.deleteMany({}),
      codes.deleteMany({}),
      counters.deleteMany({}),
      claims.deleteMany({}),
    ]);
    mockAuthMailService.sendEmailChangeCode.mockResolvedValue(true);
  });

  async function createTarget(
    pendingEmail?: string,
    addressGeneration = 0,
  ): Promise<UserDocument> {
    return users.create({
      email: 'old@example.com',
      name: 'Target User',
      role: 'user',
      isVerified: true,
      pendingEmail,
      addressGeneration,
    });
  }

  async function storedTarget(target: UserDocument): Promise<UserDocument> {
    return users.findById(target._id).orFail().exec();
  }

  it('should refuse an actor below admin level before checking availability', async () => {
    const target = await createTarget();

    await expect(
      service.assertAddressAvailable('new@example.com', UserRole.MANAGER),
    ).rejects.toMatchObject({ code: ErrorCode.EMAIL_CHANGE_NOT_ALLOWED });
    const stored = await storedTarget(target);
    expect(stored.email).toBe('old@example.com');
    expect(stored.isVerified).toBe(true);
  });

  it('should refuse an active address already in use', async () => {
    await users.create({ email: 'new@example.com', name: 'Other' });
    const target = await createTarget();

    await expect(
      service.assertAddressAvailable('new@example.com', UserRole.ADMIN),
    ).rejects.toMatchObject({ code: ErrorCode.EMAIL_ALREADY_EXISTS });
    expect((await storedTarget(target)).email).toBe('old@example.com');
  });

  it('should bind and mail the persisted pending address generation', async () => {
    const target = await createTarget('new@example.com', 1);

    await service.sendConfirmation(toStoredAccount(target), UserRole.ADMIN);

    const storedCode = await codes
      .findOne({
        email: 'new@example.com',
        purpose: PENDING_PURPOSE.EMAIL_CHANGE,
      })
      .lean()
      .exec();
    expect({
      owner: storedCode?.userId?.toString(),
      generation: storedCode?.addressGeneration,
    }).toEqual({ owner: target._id.toString(), generation: 1 });
    expect(mockAuthMailService.sendEmailChangeCode).toHaveBeenCalledWith(
      { email: 'new@example.com', locale: 'en' },
      expect.stringMatching(/^\d{6}$/),
    );
    expect((await storedTarget(target)).email).toBe('old@example.com');
  });

  it('should keep the old active address when mail fails', async () => {
    mockAuthMailService.sendEmailChangeCode.mockResolvedValueOnce(false);
    const target = await createTarget('new@example.com', 1);

    await expect(
      service.sendConfirmation(toStoredAccount(target), UserRole.ADMIN),
    ).rejects.toMatchObject({ code: ErrorCode.EMAIL_SEND_FAILED });
    expect(await storedTarget(target)).toMatchObject({
      email: 'old@example.com',
      pendingEmail: 'new@example.com',
      isVerified: true,
      addressGeneration: 1,
    });
  });

  it('should answer the mail cap with a distinct retryable error', async () => {
    for (let used = 0; used < 5; used += 1) {
      await mailCounter.tryRecord(
        'new@example.com',
        PENDING_PURPOSE.EMAIL_CHANGE,
      );
    }
    const target = await createTarget('new@example.com', 1);

    await expect(
      service.sendConfirmation(toStoredAccount(target), UserRole.ADMIN),
    ).rejects.toMatchObject({ code: ErrorCode.EMAIL_SEND_LIMIT_REACHED });
    expect(mockAuthMailService.sendEmailChangeCode).not.toHaveBeenCalled();
    expect((await storedTarget(target)).email).toBe('old@example.com');
  });

  it('should reissue a code for the waiting address without changing the account', async () => {
    const target = await createTarget('moved@example.com', 3);

    await service.resend(toStoredAccount(target), UserRole.ADMIN);

    expect(await storedTarget(target)).toMatchObject({
      email: 'old@example.com',
      pendingEmail: 'moved@example.com',
      addressGeneration: 3,
    });
    const storedCode = await codes
      .findOne({
        email: 'moved@example.com',
        purpose: PENDING_PURPOSE.EMAIL_CHANGE,
      })
      .lean()
      .exec();
    expect({
      owner: storedCode?.userId?.toString(),
      generation: storedCode?.addressGeneration,
    }).toEqual({ owner: target._id.toString(), generation: 3 });
  });

  it('should refuse to resend when no address waits', async () => {
    const target = await createTarget();

    await expect(
      service.resend(toStoredAccount(target), UserRole.ADMIN),
    ).rejects.toMatchObject({ code: ErrorCode.EMAIL_SEND_FAILED });
    expect(await codes.countDocuments({})).toBe(0);
  });

  it('should refuse to resend for an actor below admin level', async () => {
    const target = await createTarget('moved@example.com', 3);

    await expect(
      service.resend(toStoredAccount(target), UserRole.MANAGER),
    ).rejects.toMatchObject({ code: ErrorCode.EMAIL_CHANGE_NOT_ALLOWED });
    expect(await codes.countDocuments({})).toBe(0);
  });
});

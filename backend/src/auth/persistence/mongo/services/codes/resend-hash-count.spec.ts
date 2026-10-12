import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Model, createConnection } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../../../test/utils/memory-replset';
import * as bcrypt from 'bcrypt';
import { RegistrationService } from '../../../../services/registration/registration.service';
import { VerificationCodeService } from '../../../../services/codes/verification-code.service';
import { HashService } from '../../../../../common/services/hash.service';
import { Clock } from '../../../../../common/services/clock';
import {
  User,
  UserSchema,
} from '../../../../../user/persistence/mongo/schemas/user.schema';
import {
  PendingRegistration,
  PendingRegistrationSchema,
} from '../../schemas/pending-registration.schema';
import {
  MailCounter,
  MailCounterSchema,
} from '../../schemas/mail-counter.schema';
import { AuthMailService } from '../../../../services/mail/auth-mail.service';
import { SessionService } from '../../session.service';
import { MailCounterService } from '../../../../services/mail/mail-counter.service';
import { PasswordResetCodeService } from '../../../../services/codes/password-reset-code.service';
import { SessionCookieService } from '../../../../services/sessions/session-cookie.service';
import { SignInService } from '../../sign-in.service';
import {
  MAIL_COUNTER_PURPOSE,
  MAILED_CODE_LIMIT_PER_ADDRESS,
  MailCounterPurpose,
  PENDING_PURPOSE,
} from '../../../../constants/registration';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import {
  MONGO_PENDING_REGISTRATION_STORE,
  MONGO_MAIL_COUNTER_STORE,
} from '../../mongo-pending-code-stores';
import { MONGO_ACTIVATION_STORES } from '../../mongo-activation-accounts';
import { UnitOfWorkRunner } from '../../../../../common/persistence/unit-of-work';
import { MongoUnitOfWorkRunner } from '../../../../../session/persistence/mongo/mongo-unit-of-work';
import { seedMailCounter } from '../../../../../../test/utils/mail-counter-seed';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import { holdStoreCall } from '../../../../../../test/utils/pending-race';
import { PendingRegistrationStore } from '../../../../pending-codes/pending-registration.store';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';

const ROUNDS = 4;
const DTO = { email: 'user@example.com' };
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 600000);
const EXPIRED_EXPIRY = new Date(TEST_NOW.getTime() - 1000);

/**
 * Every resend path must spend exactly one code hash, whether it is the
 * verified-account path in RegistrationService or one of the three
 * resendActivationCode paths. This counts at the HashService boundary.
 */
describe('resend activation hash count', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let users: Model<User>;
  let registrations: Model<PendingRegistration>;
  let counters: Model<MailCounter>;
  let registrationService: RegistrationService;
  let service: VerificationCodeService;
  let registrationStore: PendingRegistrationStore;
  let hashSpy: jest.SpyInstance;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.getUri()).asPromise();
    users = connection.model(User.name, UserSchema);
    registrations = connection.model(
      PendingRegistration.name,
      PendingRegistrationSchema,
    );
    counters = connection.model(MailCounter.name, MailCounterSchema);
    await users.init();
    await registrations.init();
    await counters.init();

    const config = {
      get: (key: string, fallback?: number) =>
        key === 'bcrypt.rounds' ? ROUNDS : fallback,
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MONGO_PENDING_REGISTRATION_STORE,
        MONGO_MAIL_COUNTER_STORE,
        ...MONGO_ACTIVATION_STORES,
        { provide: UnitOfWorkRunner, useClass: MongoUnitOfWorkRunner },
        RegistrationService,
        VerificationCodeService,
        HashService,
        { provide: ConfigService, useValue: config },
        { provide: Clock, useValue: new FrozenClock(TEST_NOW) },
        { provide: getConnectionToken(), useValue: connection },
        { provide: getModelToken(User.name), useValue: users },
        {
          provide: getModelToken(PendingRegistration.name),
          useValue: registrations,
        },
        {
          provide: AuthMailService,
          useValue: {
            deferActivationCode: jest.fn(),
            deferRegistrationAttemptNotice: jest.fn(),
            deferPasswordResetCode: jest.fn(),
          },
        },
        { provide: SessionService, useValue: {} },
        MailCounterService,
        {
          provide: getModelToken(MailCounter.name),
          useValue: counters,
        },
        { provide: PasswordResetCodeService, useValue: {} },
        { provide: SessionCookieService, useValue: {} },
        { provide: SignInService, useValue: {} },
      ],
    }).compile();
    registrationService = module.get<RegistrationService>(RegistrationService);
    service = module.get<VerificationCodeService>(VerificationCodeService);
    registrationStore = module.get(PendingRegistrationStore);
    hashSpy = jest.spyOn(HashService.prototype, 'hash');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    hashSpy.mockRestore();
    await connection.close();
    await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    hashSpy.mockClear();
    await users.deleteMany({});
    await registrations.deleteMany({});
    await counters.deleteMany({});
  });

  function pendingRecord(overrides: Record<string, unknown> = {}) {
    return {
      email: DTO.email,
      purpose: PENDING_PURPOSE.SIGNUP,
      hashedCode: 'old-code',
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
      ...overrides,
    };
  }

  it('hashes once for a verified account', async () => {
    await users.create({ email: DTO.email, name: 'Known', isVerified: true });

    await registrationService.resendActivation(DTO);

    expect(hashSpy).toHaveBeenCalledTimes(1);
  });

  it('hashes once for an unknown address', async () => {
    await registrationService.resendActivation(DTO);

    expect(hashSpy).toHaveBeenCalledTimes(1);
    expect(await registrations.countDocuments({ email: DTO.email })).toBe(0);
  });

  async function capTheCounter(purpose: MailCounterPurpose): Promise<void> {
    await seedMailCounter(counters, {
      email: DTO.email,
      purpose,
      mailedCodes: MAILED_CODE_LIMIT_PER_ADDRESS,
    });
  }

  it('hashes once for an over-cap register', async () => {
    await capTheCounter(MAIL_COUNTER_PURPOSE.SIGNUP);

    await registrationService.register(DTO);

    expect(hashSpy).toHaveBeenCalledTimes(1);
    expect(await registrations.countDocuments({ email: DTO.email })).toBe(0);
  });

  it('hashes once for an over-cap resend', async () => {
    await capTheCounter(MAIL_COUNTER_PURPOSE.SIGNUP);

    await registrationService.resendActivation(DTO);

    expect(hashSpy).toHaveBeenCalledTimes(1);
    expect(await registrations.countDocuments({ email: DTO.email })).toBe(0);
  });

  it('hashes once for an expired record and drops it', async () => {
    await registrations.create(
      pendingRecord({
        hashedCode: await bcrypt.hash('123456', ROUNDS),
        expiresAt: EXPIRED_EXPIRY,
      }),
    );

    await registrationService.resendActivation(DTO);

    expect(hashSpy).toHaveBeenCalledTimes(1);
    expect(await registrations.countDocuments({ email: DTO.email })).toBe(0);
  });

  it('hashes once for a live record and refreshes its code', async () => {
    await registrations.create(
      pendingRecord({
        hashedCode: await bcrypt.hash('123456', ROUNDS),
        attempts: 3,
      }),
    );

    await registrationService.resendActivation(DTO);

    expect(hashSpy).toHaveBeenCalledTimes(1);
    const record = await registrations
      .findOne({ email: DTO.email })
      .select('+hashedCode');
    if (!record) throw new Error('expected a stored record');
    expect(record.attempts).toBe(0);
    expect(await bcrypt.compare('123456', record.hashedCode)).toBe(false);
  });

  it('keeps a record a register replaced before the resend delete ran', async () => {
    const email = 'resend-window@example.test';
    await registrations.create(
      pendingRecord({
        email,
        hashedCode: await bcrypt.hash('123456', ROUNDS),
        expiresAt: EXPIRED_EXPIRY,
      }),
    );

    const gate = new RaceGate();
    const restore = holdStoreCall(
      registrationStore,
      'dropExpiredRecord',
      gate,
      0,
    );
    let resendResult: unknown;
    try {
      const resend = Promise.resolve(
        service.resendActivationCode(email, PENDING_PURPOSE.SIGNUP),
      );
      await gate.reached(1);
      // A register replaces the expired record while the resend's delete waits.
      await service.createOrUpdatePendingRegistration(
        email,
        PENDING_PURPOSE.SIGNUP,
      );
      gate.release();
      resendResult = await resend;
    } finally {
      restore();
    }

    expect(resendResult).toBeNull();
    const record = await registrations.findOne({ email }).select('+hashedCode');
    if (!record) throw new Error('expected the replaced record to survive');
    expect(record.purpose).toBe(PENDING_PURPOSE.SIGNUP);
    expect(await registrations.countDocuments({ email })).toBe(1);
  });
});

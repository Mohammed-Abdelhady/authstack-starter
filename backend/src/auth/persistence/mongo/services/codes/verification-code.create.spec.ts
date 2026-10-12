import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Model, Types, createConnection } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../../../test/utils/memory-replset';
import * as bcrypt from 'bcrypt';
import { VerificationCodeService } from '../../../../services/codes/verification-code.service';
import { MailCounterService } from '../../../../services/mail/mail-counter.service';
import {
  PendingRegistration,
  PendingRegistrationSchema,
} from '../../schemas/pending-registration.schema';
import {
  MailCounter,
  MailCounterSchema,
} from '../../schemas/mail-counter.schema';
import { HashService } from '../../../../../common/services/hash.service';
import { Clock } from '../../../../../common/services/clock';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import {
  MAIL_COUNTER_PURPOSE,
  MAILED_CODE_LIMIT_PER_ADDRESS,
  PENDING_PURPOSE,
} from '../../../../constants/registration';
import { rejectionOf } from '../../../../../../test/utils/rejection';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import {
  MONGO_PENDING_REGISTRATION_STORE,
  MONGO_MAIL_COUNTER_STORE,
} from '../../mongo-pending-code-stores';
import { seedMailCounter } from '../../../../../../test/utils/mail-counter-seed';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';

const ROUNDS = 4;
const CODE_EXPIRES_IN = 900000;
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 600000);
const EXPIRED_EXPIRY = new Date(TEST_NOW.getTime() - 1000);

/**
 * What a stored pending record means, against the real database. The
 * concurrent cases live in the e2e race specs.
 */
describe('VerificationCodeService pending registration', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let registrations: Model<PendingRegistration>;
  let counters: Model<MailCounter>;
  let service: VerificationCodeService;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.getUri()).asPromise();
    registrations = connection.model<PendingRegistration>(
      PendingRegistration.name,
      PendingRegistrationSchema,
    );
    counters = connection.model(MailCounter.name, MailCounterSchema);
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
        VerificationCodeService,
        MailCounterService,
        HashService,
        { provide: ConfigService, useValue: config },
        { provide: Clock, useValue: new FrozenClock(TEST_NOW) },
        {
          provide: getModelToken(PendingRegistration.name),
          useValue: registrations,
        },
        { provide: getModelToken(MailCounter.name), useValue: counters },
      ],
    }).compile();
    service = module.get<VerificationCodeService>(VerificationCodeService);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection.close();
    await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await registrations.deleteMany({});
    await counters.deleteMany({});
  });

  async function stored(email: string) {
    const record = await registrations.findOne({ email }).select('+hashedCode');
    if (!record) throw new Error(`expected a stored record for ${email}`);
    return record;
  }

  function seed(overrides: Record<string, unknown> = {}) {
    return registrations.create({
      email: 'seed@example.test',
      purpose: PENDING_PURPOSE.SIGNUP,
      hashedCode: 'old-code',
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
      ...overrides,
    });
  }

  it('refreshes a live record and keeps no credential', async () => {
    await seed({ email: 'live@example.test', attempts: 3 });

    const result = await service.createOrUpdatePendingRegistration(
      'live@example.test',
      PENDING_PURPOSE.SIGNUP,
    );

    const record = await stored('live@example.test');
    expect(result?.code).toMatch(/^\d{6}$/);
    expect(record.attempts).toBe(0);
    const raw = await registrations.collection.findOne({
      email: 'live@example.test',
    });
    expect(raw).not.toHaveProperty('hashedPassword');
    expect(raw).not.toHaveProperty('name');
    expect(await bcrypt.compare(result?.code ?? '', record.hashedCode)).toBe(
      true,
    );
  });

  it('extends a live record to one full code lifetime', async () => {
    await seed({
      email: 'extend@example.test',
      expiresAt: new Date(TEST_NOW.getTime() + 60 * 1000),
    });

    await service.createOrUpdatePendingRegistration(
      'extend@example.test',
      PENDING_PURPOSE.SIGNUP,
    );

    const record = await stored('extend@example.test');
    expect(record.expiresAt.getTime()).toBe(
      TEST_NOW.getTime() + CODE_EXPIRES_IN,
    );
  });

  it('replaces an expired record', async () => {
    await seed({
      email: 'expired@example.test',
      expiresAt: EXPIRED_EXPIRY,
    });

    const result = await service.createOrUpdatePendingRegistration(
      'expired@example.test',
      PENDING_PURPOSE.SIGNUP,
    );

    const record = await stored('expired@example.test');
    expect(result).not.toBeNull();
    expect(record.attempts).toBe(0);
  });

  it('creates exactly one record when none is pending', async () => {
    const result = await service.createOrUpdatePendingRegistration(
      'new@example.test',
      PENDING_PURPOSE.SIGNUP,
    );

    expect(result).not.toBeNull();
    expect(
      await registrations.countDocuments({ email: 'new@example.test' }),
    ).toBe(1);
  });

  it('refuses to mail once the address is over its cap and keeps the old code', async () => {
    const email = 'capped@example.test';
    await seed({ email, hashedCode: 'still-valid-code' });
    await seedMailCounter(counters, {
      email,
      purpose: MAIL_COUNTER_PURPOSE.SIGNUP,
      mailedCodes: MAILED_CODE_LIMIT_PER_ADDRESS,
    });

    const result = await service.createOrUpdatePendingRegistration(
      email,
      PENDING_PURPOSE.SIGNUP,
    );

    expect(result).toBeNull();
    const record = await stored(email);
    expect(record.hashedCode).toBe('still-valid-code');
  });

  it('resets the cap when the window has rolled over', async () => {
    const email = 'window@example.test';
    await seedMailCounter(counters, {
      email,
      purpose: MAIL_COUNTER_PURPOSE.SIGNUP,
      mailedCodes: MAILED_CODE_LIMIT_PER_ADDRESS,
      windowStartedAt: new Date(TEST_NOW.getTime() - 15 * 60 * 1000 - 1),
    });

    const result = await service.createOrUpdatePendingRegistration(
      email,
      PENDING_PURPOSE.SIGNUP,
    );

    expect(result).not.toBeNull();
    const record = await counters.findOne({
      email,
      purpose: MAIL_COUNTER_PURPOSE.SIGNUP,
    });
    expect(record?.mailedCodes).toBe(1);
  });

  it('binds an email-change record to the user and generation', async () => {
    const userId = new Types.ObjectId();

    await service.createOrUpdatePendingRegistration(
      'moved@example.test',
      PENDING_PURPOSE.EMAIL_CHANGE,
      { userId, addressGeneration: 4 },
    );

    const record = await stored('moved@example.test');
    expect(record.purpose).toBe(PENDING_PURPOSE.EMAIL_CHANGE);
    expect(record.userId?.toString()).toBe(userId.toString());
    expect(record.addressGeneration).toBe(4);
  });

  it('lets a sign-up and an email change coexist for one address', async () => {
    await service.createOrUpdatePendingRegistration(
      'both@example.test',
      PENDING_PURPOSE.SIGNUP,
    );
    await service.createOrUpdatePendingRegistration(
      'both@example.test',
      PENDING_PURPOSE.EMAIL_CHANGE,
      { userId: new Types.ObjectId(), addressGeneration: 1 },
    );

    expect(
      await registrations.countDocuments({ email: 'both@example.test' }),
    ).toBe(2);
  });

  it('does not delete a live locked record it could not reserve', async () => {
    const email = 'locked-verify@example.test';
    await seed({
      email,
      hashedCode: await bcrypt.hash('123456', ROUNDS),
      attempts: 5,
    });

    const rejection = await rejectionOf(
      service.verifyCode(email, '123456', PENDING_PURPOSE.SIGNUP),
    );

    expect(rejection.getCode()).toBe(ErrorCode.ACTIVATION_CODE_INVALID);
    expect(await registrations.countDocuments({ email })).toBe(1);
  });

  it('deletes an expired record it could not reserve and answers the one code', async () => {
    await seed({
      email: 'expired-verify@example.test',
      hashedCode: await bcrypt.hash('123456', ROUNDS),
      expiresAt: EXPIRED_EXPIRY,
    });

    const rejection = await rejectionOf(
      service.verifyCode(
        'expired-verify@example.test',
        '123456',
        PENDING_PURPOSE.SIGNUP,
      ),
    );

    expect(rejection.getCode()).toBe(ErrorCode.ACTIVATION_CODE_INVALID);
    expect(rejection.getDetails()).toBeUndefined();
    expect(
      await registrations.countDocuments({
        email: 'expired-verify@example.test',
      }),
    ).toBe(0);
  });
});

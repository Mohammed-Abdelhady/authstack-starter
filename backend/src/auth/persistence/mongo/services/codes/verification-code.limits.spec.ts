import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Model, createConnection } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../../../test/utils/memory-replset';
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
import { runWithRequestContext } from '../../../../../common/context/request-context';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import {
  MAILED_CODE_LIMIT_PER_ADDRESS,
  MailCounterPurpose,
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
const SHORT_CODE_EXPIRES_IN = 60000;
/** Fifteen minutes, written by hand, for the default and short lifetimes. */
const WINDOW_MS = 15 * 60 * 1000;
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + CODE_EXPIRES_IN);

describe('VerificationCodeService limits', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let registrations: Model<PendingRegistration>;
  let counters: Model<MailCounter>;
  let service: VerificationCodeService;
  let clock: FrozenClock;

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
    clock = new FrozenClock(TEST_NOW);
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
        { provide: Clock, useValue: clock },
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
    clock.set(TEST_NOW);
    await registrations.deleteMany({});
    await counters.deleteMany({});
  });

  async function seedPending(overrides: Record<string, unknown> = {}) {
    await registrations.create({
      email: 'seed@example.test',
      purpose: PENDING_PURPOSE.SIGNUP,
      hashedCode: 'old-code',
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
      ...overrides,
    });
  }

  async function seedCounter(
    email: string,
    purpose: MailCounterPurpose,
    mailedCodes: number,
  ): Promise<void> {
    await seedMailCounter(counters, { email, purpose, mailedCodes });
  }

  async function stored(email: string) {
    const record = await registrations.findOne({ email }).select('+hashedCode');
    if (!record) throw new Error(`expected a stored record for ${email}`);
    return record;
  }

  /** Mail as many codes as the cap allows and count the ones issued. */
  async function burst(
    target: VerificationCodeService,
    email: string,
  ): Promise<number> {
    let issued = 0;
    for (let count = 0; count < MAILED_CODE_LIMIT_PER_ADDRESS + 2; count += 1) {
      const code = await target.createOrUpdatePendingRegistration(
        email,
        PENDING_PURPOSE.SIGNUP,
      );
      if (code) issued += 1;
    }
    return issued;
  }

  async function buildService(
    codeExpiresIn: number,
  ): Promise<VerificationCodeService> {
    const config = {
      get: (key: string, fallback?: number) => {
        if (key === 'bcrypt.rounds') return ROUNDS;
        if (key === 'activation.codeExpiresIn') return codeExpiresIn;
        return fallback;
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        MONGO_PENDING_REGISTRATION_STORE,
        MONGO_MAIL_COUNTER_STORE,
        VerificationCodeService,
        MailCounterService,
        HashService,
        { provide: ConfigService, useValue: config },
        { provide: Clock, useValue: clock },
        {
          provide: getModelToken(PendingRegistration.name),
          useValue: registrations,
        },
        { provide: getModelToken(MailCounter.name), useValue: counters },
      ],
    }).compile();
    return module.get<VerificationCodeService>(VerificationCodeService);
  }

  it('mails nothing on resend once the address is over its cap', async () => {
    const email = 'capped@example.test';
    await seedPending({ email });
    await seedCounter(
      email,
      PENDING_PURPOSE.SIGNUP,
      MAILED_CODE_LIMIT_PER_ADDRESS,
    );

    await expect(
      service.resendActivationCode(email, PENDING_PURPOSE.SIGNUP),
    ).resolves.toBeNull();

    const record = await stored(email);
    expect(record.hashedCode).toBe('old-code');
  });

  it('floors the mail window so a short code lifetime cannot loosen the cap', async () => {
    const shortService = await buildService(SHORT_CODE_EXPIRES_IN);
    const email = 'short-lifetime@example.test';

    expect(await burst(shortService, email)).toBe(
      MAILED_CODE_LIMIT_PER_ADDRESS,
    );

    // One code lifetime later the fifteen-minute window has not rolled, so the
    // sixth mail is refused even though the record has expired.
    clock.advance(SHORT_CODE_EXPIRES_IN);
    await expect(
      shortService.createOrUpdatePendingRegistration(
        email,
        PENDING_PURPOSE.SIGNUP,
      ),
    ).resolves.toBeNull();

    // After the floor the window rolls and the address is allowed again.
    clock.advance(WINDOW_MS - SHORT_CODE_EXPIRES_IN);
    await expect(
      shortService.createOrUpdatePendingRegistration(
        email,
        PENDING_PURPOSE.SIGNUP,
      ),
    ).resolves.not.toBeNull();
  });

  it('pins the cap plus attempt denial: owner register and resend mail nothing', async () => {
    const email = 'denied@example.test';

    expect(await burst(service, email)).toBe(MAILED_CODE_LIMIT_PER_ADDRESS);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejection = await rejectionOf(
        service.verifyCode(email, '000000', PENDING_PURPOSE.SIGNUP),
      );
      expect(rejection.getCode()).toBe(ErrorCode.ACTIVATION_CODE_INVALID);
    }

    const locked = await stored(email);
    expect(locked.attempts).toBe(5);

    await expect(
      service.createOrUpdatePendingRegistration(email, PENDING_PURPOSE.SIGNUP),
    ).resolves.toBeNull();
    await expect(
      service.resendActivationCode(email, PENDING_PURPOSE.SIGNUP),
    ).resolves.toBeNull();
  });

  it('keeps the cap when a junk activate deletes the expired record', async () => {
    const email = 'junk@example.test';
    const shortService = await buildService(SHORT_CODE_EXPIRES_IN);

    let total = await burst(shortService, email);
    for (let round = 0; round < 3; round += 1) {
      clock.advance(SHORT_CODE_EXPIRES_IN + 1);
      await rejectionOf(
        shortService.verifyCode(email, '000000', PENDING_PURPOSE.SIGNUP),
      );
      total += await burst(shortService, email);
    }

    expect(total).toBe(MAILED_CODE_LIMIT_PER_ADDRESS);
    expect(await registrations.countDocuments({ email })).toBe(0);
  });

  it('keeps the cap when a resend deletes the expired record', async () => {
    const email = 'resend-expiry@example.test';
    const shortService = await buildService(SHORT_CODE_EXPIRES_IN);

    let total = await burst(shortService, email);
    clock.advance(SHORT_CODE_EXPIRES_IN + 1);
    await expect(
      shortService.resendActivationCode(email, PENDING_PURPOSE.SIGNUP),
    ).resolves.toBeNull();
    total += await burst(shortService, email);

    expect(total).toBe(MAILED_CODE_LIMIT_PER_ADDRESS);
  });

  it('keeps the cap with no deletion at all', async () => {
    const email = 'control@example.test';
    const shortService = await buildService(SHORT_CODE_EXPIRES_IN);

    const first = await burst(shortService, email);
    clock.advance(SHORT_CODE_EXPIRES_IN + 1);
    const second = await burst(shortService, email);

    expect(first).toBe(MAILED_CODE_LIMIT_PER_ADDRESS);
    expect(second).toBe(0);
  });

  it('keeps the cap across the default lifetime before the window rolls', async () => {
    const email = 'default-lifetime@example.test';

    const first = await burst(service, email);
    clock.advance(CODE_EXPIRES_IN - 1);
    const second = await burst(service, email);

    expect(first).toBe(MAILED_CODE_LIMIT_PER_ADDRESS);
    expect(second).toBe(0);
  });

  it('counts each purpose on its own counter', async () => {
    const email = 'per-purpose@example.test';

    expect(await burst(service, email)).toBe(MAILED_CODE_LIMIT_PER_ADDRESS);
    await expect(
      service.createOrUpdatePendingRegistration(
        email,
        PENDING_PURPOSE.EMAIL_CHANGE,
      ),
    ).resolves.not.toBeNull();
  });

  it('logs the request id, never the address', async () => {
    const email = 'log-check@example.test';
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});

    await runWithRequestContext('req-code', () =>
      service.createOrUpdatePendingRegistration(email, PENDING_PURPOSE.SIGNUP),
    );

    const logged = logSpy.mock.calls
      .map((call: unknown[]) => call.map((v) => String(v)).join(' '))
      .join('\n');
    expect(logged).toContain('requestId=req-code');
    expect(logged).not.toContain(email);
    logSpy.mockRestore();
  });
});

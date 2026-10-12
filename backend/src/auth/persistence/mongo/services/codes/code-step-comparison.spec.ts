import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Model, createConnection } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../../../test/utils/memory-replset';
import * as bcrypt from 'bcrypt';
import { VerificationCodeService } from '../../../../services/codes/verification-code.service';
import { PasswordResetCodeService } from '../../../../services/codes/password-reset-code.service';
import { MailCounterService } from '../../../../services/mail/mail-counter.service';
import {
  PendingRegistration,
  PendingRegistrationSchema,
} from '../../schemas/pending-registration.schema';
import {
  PendingPasswordReset,
  PendingPasswordResetSchema,
} from '../../schemas/pending-password-reset.schema';
import { HashService } from '../../../../../common/services/hash.service';
import { Clock } from '../../../../../common/services/clock';
import { PENDING_PURPOSE } from '../../../../constants/registration';
import { rejectionOf } from '../../../../../../test/utils/rejection';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import {
  MONGO_PENDING_REGISTRATION_STORE,
  MONGO_PASSWORD_RESET_CODE_STORE,
} from '../../mongo-pending-code-stores';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';
import {
  MailCounter,
  MailCounterSchema,
} from '../../schemas/mail-counter.schema';

const CODE = '123456';
const WRONG_CODE = '000000';
const MAX_ATTEMPTS = 5;
const ROUNDS = 4;

/** The cost factor a bcrypt hash string was made with, for example 4 or 10. */
function costOf(hash: string): number {
  return Number(hash.split('$')[2]);
}

/**
 * Every failing code step must run the same bcrypt comparison a live record
 * runs, or the answer leaks by how long it took. This counts the calls at the
 * HashService boundary for each failing path.
 */
describe('code-step comparison count', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let guessCounters: Model<MailCounter>;
  let registrations: Model<PendingRegistration>;
  let resets: Model<PendingPasswordReset>;
  let verification: VerificationCodeService;
  let passwordReset: PasswordResetCodeService;
  let hashService: HashService;
  let configService: ConfigService;
  let compareSpy: jest.SpyInstance;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.getUri()).asPromise();
    registrations = connection.model<PendingRegistration>(
      PendingRegistration.name,
      PendingRegistrationSchema,
    );
    resets = connection.model<PendingPasswordReset>(
      PendingPasswordReset.name,
      PendingPasswordResetSchema,
    );
    await Promise.all([registrations.init(), resets.init()]);
    const config = {
      get: (key: string, fallback?: number) =>
        key === 'bcrypt.rounds' ? ROUNDS : fallback,
    };
    guessCounters = connection.model(MailCounter.name, MailCounterSchema);
    await guessCounters.init();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MONGO_PENDING_REGISTRATION_STORE,
        MONGO_PASSWORD_RESET_CODE_STORE,
        VerificationCodeService,
        PasswordResetCodeService,
        HashService,
        { provide: ConfigService, useValue: config },
        { provide: Clock, useValue: new FrozenClock(TEST_NOW) },
        {
          provide: getModelToken(PendingRegistration.name),
          useValue: registrations,
        },
        {
          provide: getModelToken(PendingPasswordReset.name),
          useValue: resets,
        },
        {
          provide: MailCounterService,
          useValue: { tryRecord: jest.fn().mockResolvedValue(true) },
        },
        { provide: getModelToken(MailCounter.name), useValue: guessCounters },
      ],
    }).compile();
    verification = module.get<VerificationCodeService>(VerificationCodeService);
    passwordReset = module.get<PasswordResetCodeService>(
      PasswordResetCodeService,
    );
    hashService = module.get<HashService>(HashService);
    configService = module.get<ConfigService>(ConfigService);
    compareSpy = jest.spyOn(HashService.prototype, 'compare');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    compareSpy.mockRestore();
    await connection.close();
    await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await registrations.deleteMany({});
    await resets.deleteMany({});
    await guessCounters.deleteMany({});
    compareSpy.mockClear();
  });

  const live = () => new Date(TEST_NOW.getTime() + 600000);
  const expired = () => new Date(TEST_NOW.getTime() - 1000);

  async function seedRegistration(
    email: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    await registrations.create({
      email,
      purpose: PENDING_PURPOSE.SIGNUP,
      hashedCode: await bcrypt.hash(CODE, ROUNDS),
      attempts: 0,
      expiresAt: live(),
      ...overrides,
    });
  }

  async function seedReset(
    email: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    await resets.create({
      email,
      hashedCode: await bcrypt.hash(CODE, ROUNDS),
      attempts: 0,
      expiresAt: live(),
      ...overrides,
    });
  }

  describe('activation', () => {
    it('compares once for a wrong code on a live record', async () => {
      await seedRegistration('wrong@example.test');
      await rejectionOf(
        verification.verifyCode(
          'wrong@example.test',
          WRONG_CODE,
          PENDING_PURPOSE.SIGNUP,
        ),
      );
      expect(compareSpy).toHaveBeenCalledTimes(1);
    });

    it('compares once when no record exists', async () => {
      await rejectionOf(
        verification.verifyCode(
          'none@example.test',
          CODE,
          PENDING_PURPOSE.SIGNUP,
        ),
      );
      expect(compareSpy).toHaveBeenCalledTimes(1);
    });

    it('compares once when the record has expired', async () => {
      await seedRegistration('expired@example.test', {
        expiresAt: expired(),
      });
      await rejectionOf(
        verification.verifyCode(
          'expired@example.test',
          CODE,
          PENDING_PURPOSE.SIGNUP,
        ),
      );
      expect(compareSpy).toHaveBeenCalledTimes(1);
    });

    it('compares once when the record is locked', async () => {
      await seedRegistration('locked@example.test', {
        attempts: MAX_ATTEMPTS,
      });
      await rejectionOf(
        verification.verifyCode(
          'locked@example.test',
          CODE,
          PENDING_PURPOSE.SIGNUP,
        ),
      );
      expect(compareSpy).toHaveBeenCalledTimes(1);
    });

    it('compares once per request when two verifications race', async () => {
      await seedRegistration('race@example.test');
      const results = await Promise.allSettled([
        verification.verifyCode(
          'race@example.test',
          CODE,
          PENDING_PURPOSE.SIGNUP,
        ),
        verification.verifyCode(
          'race@example.test',
          CODE,
          PENDING_PURPOSE.SIGNUP,
        ),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(2);
      // Both requests compared their own reserved generation.
      expect(compareSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('password reset', () => {
    it('compares once for a wrong code on a live record', async () => {
      await seedReset('wrong@example.test');
      await rejectionOf(
        passwordReset.verifyPasswordReset('wrong@example.test', WRONG_CODE),
      );
      expect(compareSpy).toHaveBeenCalledTimes(1);
    });

    it('compares once when no record exists', async () => {
      await rejectionOf(
        passwordReset.verifyPasswordReset('none@example.test', CODE),
      );
      expect(compareSpy).toHaveBeenCalledTimes(1);
    });

    it('compares once when the record has expired', async () => {
      await seedReset('expired@example.test', { expiresAt: expired() });
      await rejectionOf(
        passwordReset.verifyPasswordReset('expired@example.test', CODE),
      );
      expect(compareSpy).toHaveBeenCalledTimes(1);
    });

    it('compares once when the record is locked', async () => {
      await seedReset('locked@example.test', { attempts: MAX_ATTEMPTS });
      await rejectionOf(
        passwordReset.verifyPasswordReset('locked@example.test', CODE),
      );
      expect(compareSpy).toHaveBeenCalledTimes(1);
    });

    it('compares once per request when the other consume wins the record', async () => {
      await seedReset('race@example.test');
      const first = await passwordReset.verifyPasswordReset(
        'race@example.test',
        CODE,
      );
      const second = await passwordReset.verifyPasswordReset(
        'race@example.test',
        CODE,
      );
      const consumed = await Promise.all([
        passwordReset.consumePasswordReset(first.id, first.hashedCode),
        passwordReset.consumePasswordReset(second.id, second.hashedCode),
      ]);

      expect(consumed.filter(Boolean)).toHaveLength(1);
      // Both requests compared before either consumed.
      expect(compareSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('gives the dummy comparison the same bcrypt cost as a real hash', async () => {
    compareSpy.mockClear();
    await hashService.spendComparison('submitted');

    const dummyHash = String(compareSpy.mock.calls[0]?.[1]);
    const realHash = await hashService.hash('real-value');

    expect(costOf(dummyHash)).toBe(costOf(realHash));
    expect(costOf(dummyHash)).toBe(ROUNDS);
  });

  it('retries the dummy hash after a failure instead of caching the rejection', async () => {
    const fresh = new HashService(configService);
    const hashSpy = jest.spyOn(HashService.prototype, 'hash');
    hashSpy.mockRejectedValueOnce(new Error('hash failed'));

    try {
      await expect(fresh.spendComparison('first')).rejects.toThrow(
        'hash failed',
      );
      await expect(fresh.spendComparison('second')).resolves.toBeUndefined();
      expect(hashSpy).toHaveBeenCalledTimes(2);
    } finally {
      hashSpy.mockRestore();
    }
  });
});

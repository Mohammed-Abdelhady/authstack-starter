import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Connection, createConnection, Model } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../../../test/utils/memory-replset';
import { PasswordResetCodeService } from '../../../../services/codes/password-reset-code.service';
import {
  PendingPasswordReset,
  PendingPasswordResetSchema,
} from '../../schemas/pending-password-reset.schema';
import { HashService } from '../../../../../common/services/hash.service';
import { Clock } from '../../../../../common/services/clock';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import { MONGO_PASSWORD_RESET_CODE_STORE } from '../../mongo-pending-code-stores';
import {
  MailCounter,
  MailCounterSchema,
} from '../../schemas/mail-counter.schema';

const ROUNDS = 4;

describe('PasswordResetCodeService concurrency', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let guessCounters: Model<MailCounter>;
  let model: Model<PendingPasswordReset>;
  let service: PasswordResetCodeService;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.getUri()).asPromise();
    model = connection.model<PendingPasswordReset>(
      PendingPasswordReset.name,
      PendingPasswordResetSchema,
    );
    await model.init();
    const config = new ConfigService({ bcrypt: { rounds: ROUNDS } });
    guessCounters = connection.model(MailCounter.name, MailCounterSchema);
    await guessCounters.init();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MONGO_PASSWORD_RESET_CODE_STORE,
        PasswordResetCodeService,
        HashService,
        { provide: ConfigService, useValue: config },
        { provide: Clock, useValue: new FrozenClock(TEST_NOW) },
        {
          provide: getModelToken(PendingPasswordReset.name),
          useValue: model,
        },
        { provide: getModelToken(MailCounter.name), useValue: guessCounters },
      ],
    }).compile();
    service = module.get<PasswordResetCodeService>(PasswordResetCodeService);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection.close();
    await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await model.deleteMany({});
    await guessCounters.deleteMany({});
  });

  it('should let only one of two concurrent valid consumes change the password', async () => {
    const code = await service.createOrUpdatePasswordReset('user@example.com');

    const reserved = await Promise.all([
      service.verifyPasswordReset('user@example.com', code),
      service.verifyPasswordReset('user@example.com', code),
    ]);

    const consumed = await Promise.all([
      service.consumePasswordReset(reserved[0].id, reserved[0].hashedCode),
      service.consumePasswordReset(reserved[1].id, reserved[1].hashedCode),
    ]);

    expect(consumed.filter(Boolean)).toHaveLength(1);
    expect(await model.findOne({ email: 'user@example.com' })).toBeNull();
  });

  it('should cap concurrent wrong-code attempts at the configured limit', async () => {
    await service.createOrUpdatePasswordReset('user@example.com');

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.verifyPasswordReset('user@example.com', '000000'),
      ),
    );

    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(rejected).toHaveLength(8);
    for (const result of rejected) {
      expect(result.reason).toMatchObject({
        code: ErrorCode.PASSWORD_RESET_CODE_INVALID,
      });
    }

    // The limit still bites: five attempts were spent, and the record is
    // locked, not gone. Read it from the database, not from the answer.
    const stored = await model.findOne({ email: 'user@example.com' });
    expect(stored?.attempts).toBe(5);
  });

  it('should refuse consume after the reserved generation expires', async () => {
    const code = await service.createOrUpdatePasswordReset('user@example.com');
    const reserved = await service.verifyPasswordReset(
      'user@example.com',
      code,
    );

    await model.updateOne(
      { _id: reserved.id },
      { $set: { expiresAt: new Date(TEST_NOW.getTime() - 1000) } },
    );

    await expect(
      service.consumePasswordReset(reserved.id, reserved.hashedCode),
    ).resolves.toBe(false);
  });

  it('should not consume a reissued generation from a stale reservation', async () => {
    const first = await service.createOrUpdatePasswordReset('user@example.com');
    const reserved = await service.verifyPasswordReset(
      'user@example.com',
      first,
    );

    await service.createOrUpdatePasswordReset('user@example.com');

    await expect(
      service.consumePasswordReset(reserved.id, reserved.hashedCode),
    ).resolves.toBe(false);
    expect(
      await model.findOne({ email: { $eq: 'user@example.com' } }),
    ).not.toBeNull();
  });
});

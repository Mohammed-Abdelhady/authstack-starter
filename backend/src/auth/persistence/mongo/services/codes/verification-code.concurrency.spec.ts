import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { ClientSession, Connection, createConnection, Model } from 'mongoose';
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
import { HashService } from '../../../../../common/services/hash.service';
import { Clock } from '../../../../../common/services/clock';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { PENDING_PURPOSE } from '../../../../constants/registration';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import { mongoUnitOfWork } from '../../../../../session/persistence/mongo/mongo-unit-of-work';
import { MONGO_PENDING_REGISTRATION_STORE } from '../../mongo-pending-code-stores';
import {
  MailCounter,
  MailCounterSchema,
} from '../../schemas/mail-counter.schema';

describe('VerificationCodeService concurrency', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let guessCounters: Model<MailCounter>;
  let model: Model<PendingRegistration>;
  let service: VerificationCodeService;
  let hashService: HashService;
  let sessions: ClientSession[];

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.getUri()).asPromise();
    model = connection.model<PendingRegistration>(
      PendingRegistration.name,
      PendingRegistrationSchema,
    );
    await model.init();
    const config = {
      get: (_key: string, fallback?: number) => fallback ?? 4,
    };
    guessCounters = connection.model(MailCounter.name, MailCounterSchema);
    await guessCounters.init();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MONGO_PENDING_REGISTRATION_STORE,
        VerificationCodeService,
        HashService,
        { provide: ConfigService, useValue: config },
        { provide: Clock, useValue: new FrozenClock(TEST_NOW) },
        { provide: getModelToken(PendingRegistration.name), useValue: model },
        {
          provide: MailCounterService,
          useValue: { tryRecord: jest.fn().mockResolvedValue(true) },
        },
        { provide: getModelToken(MailCounter.name), useValue: guessCounters },
      ],
    }).compile();
    service = module.get<VerificationCodeService>(VerificationCodeService);
    hashService = module.get<HashService>(HashService);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection.close();
    await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await model.deleteMany({});
    await guessCounters.deleteMany({});
    sessions = [];
  });

  afterEach(async () => {
    for (const session of sessions) {
      await session.endSession();
    }
  });

  async function startSession(): Promise<ClientSession> {
    const session = await connection.startSession();
    sessions.push(session);
    return session;
  }

  async function issueCode(email: string): Promise<string> {
    const issued = await service.createOrUpdatePendingRegistration(
      email,
      PENDING_PURPOSE.SIGNUP,
    );
    if (!issued) throw new Error('expected a code to be issued');
    return issued.code;
  }

  it('should let only one concurrent valid activation consume the record', async () => {
    const email = 'user@example.com';
    const code = await issueCode(email);

    const first = await service.verifyCode(email, code, PENDING_PURPOSE.SIGNUP);
    const second = await service.verifyCode(
      email,
      code,
      PENDING_PURPOSE.SIGNUP,
    );

    const results = await Promise.all([
      service.consumeCode(first, mongoUnitOfWork(await startSession())),
      service.consumeCode(second, mongoUnitOfWork(await startSession())),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await model.findOne({ email })).toBeNull();
  });

  it('should cap concurrent wrong-code attempts at the configured limit', async () => {
    const email = 'user@example.com';
    await issueCode(email);

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.verifyCode(email, '000000', PENDING_PURPOSE.SIGNUP),
      ),
    );

    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(rejected).toHaveLength(8);
    for (const result of rejected) {
      expect(result.reason).toMatchObject({
        code: ErrorCode.ACTIVATION_CODE_INVALID,
      });
    }

    // The limit still bites: five attempts were spent, and the record is
    // locked, not gone. Read it from the database, not from the answer.
    const stored = await model.findOne({ email });
    expect(stored?.attempts).toBe(5);
  });

  it('should not let a stale generation be consumed after the code was reissued', async () => {
    const email = 'user@example.com';
    const first = await issueCode(email);

    let releaseCompare: () => void = () => undefined;
    const delayed = new Promise<void>((resolve) => {
      releaseCompare = resolve;
    });
    let compareStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      compareStarted = resolve;
    });
    const originalCompare = hashService.compare.bind(hashService);
    jest
      .spyOn(HashService.prototype, 'compare')
      .mockImplementation(async (plain, hash) => {
        compareStarted();
        await delayed;
        return originalCompare(plain, hash);
      });

    const verify = service.verifyCode(email, first, PENDING_PURPOSE.SIGNUP);
    await started;
    await issueCode(email);
    releaseCompare();

    const reserved = await verify;
    const consumed = await service.consumeCode(
      reserved,
      mongoUnitOfWork(await startSession()),
    );

    expect(consumed).toBe(false);
    expect(await model.findOne({ email: { $eq: email } })).not.toBeNull();
    jest.restoreAllMocks();
  });

  it('should refuse consume when the reserved generation expires during compare', async () => {
    const email = 'user@example.com';
    const code = await issueCode(email);

    let releaseCompare: () => void = () => undefined;
    const delayed = new Promise<void>((resolve) => {
      releaseCompare = resolve;
    });
    let compareStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      compareStarted = resolve;
    });
    const originalCompare = hashService.compare.bind(hashService);
    jest
      .spyOn(HashService.prototype, 'compare')
      .mockImplementation(async (plain, hash) => {
        compareStarted();
        await delayed;
        return originalCompare(plain, hash);
      });

    const verify = service.verifyCode(email, code, PENDING_PURPOSE.SIGNUP);
    await started;
    await model.updateMany(
      { email },
      { $set: { expiresAt: new Date(TEST_NOW.getTime() - 1000) } },
    );
    releaseCompare();

    const reserved = await verify;
    const consumed = await service.consumeCode(
      reserved,
      mongoUnitOfWork(await startSession()),
    );

    expect(consumed).toBe(false);
    jest.restoreAllMocks();
  });
});

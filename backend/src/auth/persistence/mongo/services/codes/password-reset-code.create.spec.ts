import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Connection, Model, createConnection } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../../../test/utils/memory-replset';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { PasswordResetCodeService } from '../../../../services/codes/password-reset-code.service';
import {
  PendingPasswordReset,
  PendingPasswordResetSchema,
} from '../../schemas/pending-password-reset.schema';
import { HashService } from '../../../../../common/services/hash.service';
import { Clock } from '../../../../../common/services/clock';
import { rejectionOf } from '../../../../../../test/utils/rejection';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import { MONGO_PASSWORD_RESET_CODE_STORE } from '../../mongo-pending-code-stores';
import { RaceGate } from '../../../../../../test/utils/race-gate';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';
import {
  MailCounter,
  MailCounterSchema,
} from '../../schemas/mail-counter.schema';

const ROUNDS = 4;
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 600000);
const EXPIRED_EXPIRY = new Date(TEST_NOW.getTime() - 1000);

/**
 * What a stored pending password reset means, against the real database. The
 * concurrent cases live in the e2e race specs.
 */
describe('PasswordResetCodeService pending reset', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let guessCounters: Model<MailCounter>;
  let resets: Model<PendingPasswordReset>;
  let service: PasswordResetCodeService;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.getUri()).asPromise();
    resets = connection.model<PendingPasswordReset>(
      PendingPasswordReset.name,
      PendingPasswordResetSchema,
    );
    // The duplicate-key case needs the unique index before the race.
    await resets.init();
    const config = {
      get: (key: string, fallback?: number) =>
        key === 'bcrypt.rounds' ? ROUNDS : fallback,
    };
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
          useValue: resets,
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
    await resets.deleteMany({});
    await guessCounters.deleteMany({});
  });

  async function stored(email: string) {
    const record = await resets.findOne({ email }).select('+hashedCode');
    if (!record) throw new Error(`expected a stored record for ${email}`);
    return record;
  }

  it('updates the code of an existing record without creating', async () => {
    await resets.create({
      email: 'existing@example.test',
      hashedCode: await bcrypt.hash('old-code', ROUNDS),
      attempts: 3,
      expiresAt: LIVE_EXPIRY,
    });

    const code = await service.createOrUpdatePasswordReset(
      'existing@example.test',
    );

    const record = await stored('existing@example.test');
    expect(record.attempts).toBe(0);
    expect(await bcrypt.compare(code, record.hashedCode)).toBe(true);
    expect(
      await resets.countDocuments({ email: 'existing@example.test' }),
    ).toBe(1);
  });

  it('creates exactly one record when none is pending', async () => {
    const code = await service.createOrUpdatePasswordReset('new@example.test');

    const record = await stored('new@example.test');
    expect(await bcrypt.compare(code, record.hashedCode)).toBe(true);
    expect(await resets.countDocuments({ email: 'new@example.test' })).toBe(1);
  });

  it('returns only the commitment for the stored native reset generation', async () => {
    const first = await service.createOrUpdatePasswordResetWithGeneration(
      'native-reset-generation@example.test',
    );
    const firstRecord = await stored('native-reset-generation@example.test');

    expect(first.generationHash).toBe(
      createHash('sha256').update(firstRecord.hashedCode).digest('hex'),
    );
    expect(first.generationHash).not.toBe(first.code);
    expect(await bcrypt.compare(first.code, firstRecord.hashedCode)).toBe(true);

    const second = await service.createOrUpdatePasswordResetWithGeneration(
      'native-reset-generation@example.test',
    );
    const secondRecord = await stored('native-reset-generation@example.test');

    expect(second.generationHash).toBe(
      createHash('sha256').update(secondRecord.hashedCode).digest('hex'),
    );
    expect(second.generationHash).not.toBe(first.generationHash);
    expect(await bcrypt.compare(second.code, secondRecord.hashedCode)).toBe(
      true,
    );
  });

  it('updates the winner when two creates race on the unique index', async () => {
    const firstGate = new RaceGate();
    const secondGate = new RaceGate();
    const originalCreate = resets.create.bind(resets);
    let call = 0;
    const spy = jest.spyOn(resets, 'create').mockImplementation((...args) => {
      const gate = call === 0 ? firstGate : secondGate;
      call += 1;
      return gate.hold().then(() => originalCreate(...args));
    });

    let firstCode: string;
    let secondCode: string;
    try {
      const first = service.createOrUpdatePasswordReset('race@example.test');
      await firstGate.reached(1);
      const second = service.createOrUpdatePasswordReset('race@example.test');
      await secondGate.reached(1);

      firstGate.release();
      firstCode = await first;
      secondGate.release();
      secondCode = await second;
    } finally {
      spy.mockRestore();
    }

    const record = await stored('race@example.test');
    expect(await resets.countDocuments({ email: 'race@example.test' })).toBe(1);
    expect(await bcrypt.compare(firstCode, record.hashedCode)).toBe(false);
    expect(await bcrypt.compare(secondCode, record.hashedCode)).toBe(true);
  });

  it('deletes an expired record it could not reserve and answers the one code', async () => {
    await resets.create({
      email: 'expired@example.test',
      hashedCode: await bcrypt.hash('123456', ROUNDS),
      attempts: 0,
      expiresAt: EXPIRED_EXPIRY,
    });

    const rejection = await rejectionOf(
      service.verifyPasswordReset('expired@example.test', '123456'),
    );

    expect(rejection.getCode()).toBe(ErrorCode.PASSWORD_RESET_CODE_INVALID);
    expect(rejection.getDetails()).toBeUndefined();
    expect(await resets.countDocuments({ email: 'expired@example.test' })).toBe(
      0,
    );
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import express, { Response } from 'express';
import { Connection, Model, createConnection } from 'mongoose';
import {
  startMemoryReplSet,
  type MemoryReplSet,
} from '../../../../test/utils/memory-replset';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../auth.service';
import {
  User,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { HashService } from '../../../common/services/hash.service';
import { AuthMailService } from '../../services/mail/auth-mail.service';
import { Sessions } from '../../services/sessions/sessions';
import { VerificationCodeService } from '../../services/codes/verification-code.service';
import { MailCounterService } from '../../services/mail/mail-counter.service';
import { PasswordResetCodeService } from '../../services/codes/password-reset-code.service';
import { SignInCompletion } from '../../services/sessions/sign-in-completion';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { IdFormat } from '../../../common/persistence/id-format';
import { MongoIdFormat } from '../../../common/persistence/mongo/mongo-id-format';
import { MONGO_PASSWORD_SIGN_IN_STORE } from './mongo-password-sign-in.store';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';

const ROUNDS = 4;
const PASSWORD = 'Password123!';
const NEW_PASSWORD = 'NewPassword123!';

describe('AuthService sign-in and password reset (real database)', () => {
  let mongo: MemoryReplSet;
  let connection: Connection;
  let users: Model<User>;
  let service: AuthService;
  let sessionService: { invalidateAllSessions: jest.Mock };
  let signInService: { completeSignIn: jest.Mock };
  let passwordResetCodeService: {
    verifyPasswordReset: jest.Mock;
    consumePasswordReset: jest.Mock;
  };
  let compareSpy: jest.SpyInstance;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    connection = await createConnection(mongo.getUri()).asPromise();
    users = connection.model<User>(User.name, UserSchema);
    await users.init();

    const config = {
      get: (key: string, fallback?: number) =>
        key === 'bcrypt.rounds' ? ROUNDS : fallback,
    };
    sessionService = { invalidateAllSessions: jest.fn() };
    signInService = {
      completeSignIn: jest.fn().mockResolvedValue({
        requiresTwoFactor: false,
        user: { id: 'user-id', email: 'user@example.com' },
      }),
    };
    passwordResetCodeService = {
      verifyPasswordReset: jest.fn().mockResolvedValue({
        id: 'reset-id',
        hashedCode: 'hashed-code',
      }),
      consumePasswordReset: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        HashService,
        { provide: ConfigService, useValue: config },
        { provide: getConnectionToken(), useValue: connection },
        { provide: getModelToken(User.name), useValue: users },
        MONGO_PASSWORD_SIGN_IN_STORE,
        { provide: IdFormat, useClass: MongoIdFormat },
        { provide: AuthMailService, useValue: {} },
        { provide: Sessions, useValue: sessionService },
        { provide: VerificationCodeService, useValue: {} },
        {
          provide: MailCounterService,
          useValue: { tryRecord: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: PasswordResetCodeService,
          useValue: passwordResetCodeService,
        },
        { provide: SignInCompletion, useValue: signInService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    compareSpy = jest.spyOn(HashService.prototype, 'compare');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    compareSpy.mockRestore();
    await connection.close();
    await mongo.stop();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await users.deleteMany({});
    compareSpy.mockClear();
    sessionService.invalidateAllSessions.mockClear();
    signInService.completeSignIn.mockClear();
    signInService.completeSignIn.mockResolvedValue({
      requiresTwoFactor: false,
      user: { id: 'user-id', email: 'user@example.com' },
    });
    passwordResetCodeService.consumePasswordReset.mockResolvedValue(true);
  });

  async function createUser(overrides: Record<string, unknown> = {}) {
    return users.create({
      email: 'user@example.com',
      name: 'Test User',
      password: await bcrypt.hash(PASSWORD, ROUNDS),
      isVerified: true,
      ...overrides,
    });
  }

  it('rejects a soft-deleted or unknown address after one comparison that never reads a stored password', async () => {
    const storedHash = await bcrypt.hash(PASSWORD, ROUNDS);
    await createUser({
      email: 'deleted@example.com',
      isDeleted: true,
      password: storedHash,
    });

    await expect(
      service.login(
        { email: 'deleted@example.com', password: PASSWORD },
        response(),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    await expect(
      service.login(
        { email: 'nobody@example.com', password: PASSWORD },
        response(),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });

    // One comparison an attempt, against the dummy hash both times.
    const compared = compareSpy.mock.calls.map(([, hash]) => String(hash));
    expect(compared).toHaveLength(2);
    expect(compared[0]).toBe(compared[1]);
    expect(compared).not.toContain(storedHash);
  });

  it('rejects an account with no password, such as an OAuth-only account', async () => {
    await createUser({ email: 'oauth@example.com', password: undefined });

    await expect(
      service.login(
        { email: 'oauth@example.com', password: PASSWORD },
        response(),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('finishes a valid sign-in through the shared sign-in path', async () => {
    await createUser();

    const result = await service.login(
      { email: 'user@example.com', password: PASSWORD },
      response(),
    );

    expect(result.success).toBe(true);
    expect(signInService.completeSignIn).toHaveBeenCalledTimes(1);
    // feature:totp:start
    const [, , firstFactor]: unknown[] =
      signInService.completeSignIn.mock.calls[0];
    expect(firstFactor).toBe('password');
    // feature:totp:end
  });

  it('holds the sign-in when the account owes a second factor', async () => {
    await createUser();
    signInService.completeSignIn.mockResolvedValueOnce({
      requiresTwoFactor: true,
    });

    const result = await service.login(
      { email: 'user@example.com', password: PASSWORD },
      response(),
    );

    expect(result.data).toMatchObject({ requiresTwoFactor: true });
  });

  it('changes the password and invalidates the other sessions on reset', async () => {
    const user = await createUser();

    const result = await service.resetPassword({
      email: 'user@example.com',
      code: '123456',
      newPassword: NEW_PASSWORD,
    });

    expect(result.success).toBe(true);
    expect(sessionService.invalidateAllSessions).toHaveBeenCalledWith(
      user._id.toString(),
    );
    const stored = await users.findById(user._id).select('+password');
    expect(await bcrypt.compare(NEW_PASSWORD, stored?.password ?? '')).toBe(
      true,
    );
  });

  it('rejects a reset for an address without an account', async () => {
    await expect(
      service.resetPassword({
        email: 'nobody@example.com',
        code: '123456',
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.USER_NOT_FOUND_FOR_RESET });
  });

  /** The response is only passed through to the mocked sign-in path. */
  function response(): Response {
    return Object.create(express.response) as Response;
  }
});

import { AccountCreationPolicy } from '../../../services/registration/account-creation-policy';
import { UnitOfWorkRunner } from '../../../../common/persistence/unit-of-work';
import { createConnectionMock } from '../../../../common/persistence/mongo/mongo-test-doubles.harness-spec';
import { MongoUnitOfWorkRunner } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import type { Request } from 'express';
import {
  MAGIC_LINK_EXPIRES_IN,
  MAGIC_LINK_MAX_PER_HOUR,
} from '../../magic-link-limits.harness-spec';
import { MagicLinkService } from '../../magic-link.service';
import { MagicLinkBrowserService } from '../../magic-link-browser.service';
import { SessionCookieService } from '../../../services/sessions/session-cookie.service';
import { Sessions } from '../../../services/sessions/sessions';
import { PendingMagicLink } from './schemas/pending-magic-link.schema';
import { MagicLinkStore } from '../../stores/magic-link.store';
import {
  MagicLinkAccounts,
  MagicLinkSignIn,
} from '../../stores/magic-link-accounts';
import { MongoMagicLinkStore } from './mongo-magic-link.store';
import {
  MongoMagicLinkAccounts,
  MongoMagicLinkSignIn,
} from './mongo-magic-link-accounts';
import { AuthMailService } from '../../../services/mail/auth-mail.service';
import { MailCounter } from '../../../persistence/mongo/schemas/mail-counter.schema';
import { MailDispatcherService } from '../../../../mail/mail-dispatcher.service';
import { MailService } from '../../../../mail/mail.service';
import { SignInService } from '../../../persistence/mongo/sign-in.service';
import { User } from '../../../../user/persistence/mongo/schemas/user.schema';
import { AuthProvider } from '../../../../user/enums/auth-provider.enum';
import { Clock } from '../../../../common/services/clock';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import {
  createRequestMock,
  createResponseMock,
  partialMock,
} from '../../../../common/testing/test-doubles.harness-spec';

/**
 * Shared setup for the MagicLinkService specs.
 * The file ends in -spec.ts rather than .spec.ts: the build excludes it and
 * jest does not collect it as a suite of its own.
 */

export interface MagicLinkHarness {
  service: MagicLinkService;
  clock: FrozenClock;
  policy: AccountCreationPolicy;
  pendingModel: { create: jest.Mock; findOneAndUpdate: jest.Mock };
  /** The cap's counter. Its answer is the count after this request. */
  counterModel: { findOneAndUpdate: jest.Mock };
  userModel: { findOne: jest.Mock; exists: jest.Mock; create: jest.Mock };
  authMailService: { sendMagicLink: jest.Mock };
  signInService: { completeSignIn: jest.Mock; issueSession: jest.Mock };
}

export { MAGIC_LINK_EXPIRES_IN, MAGIC_LINK_MAX_PER_HOUR };

export const MOCK_USER = {
  _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
  email: 'user@example.com',
  name: 'Test User',
  role: 'user',
  permissions: [],
  authProvider: AuthProvider.EMAIL,
  isVerified: true,
  isDeleted: false,
  save: jest.fn().mockResolvedValue(undefined),
};

/** Summary a finished sign-in hands back, as SignInService would build it. */
export const MOCK_USER_SUMMARY = {
  id: '507f1f77bcf86cd799439011',
  email: 'user@example.com',
  name: 'Test User',
  role: 'user',
  authProvider: AuthProvider.EMAIL,
  isVerified: true,
  permissions: ['read'],
};

export const MOCK_REQUEST: Request = createRequestMock({
  ip: '127.0.0.1',
  headers: { 'user-agent': 'test-agent' },
});

export const MOCK_RESPONSE = createResponseMock({
  req: {
    headers: { 'user-agent': 'test-agent' },
    ip: '127.0.0.1',
  },
  cookie: jest.fn(),
  clearCookie: jest.fn(),
});

const CONFIG_VALUES: Record<string, string | number> = {
  'magicLink.expiresIn': MAGIC_LINK_EXPIRES_IN,
  'magicLink.maxPerHour': MAGIC_LINK_MAX_PER_HOUR,
  'cors.clientUrl': 'http://localhost:3000',
};

export async function createMagicLinkHarness(): Promise<MagicLinkHarness> {
  const clock = new FrozenClock(TEST_NOW);
  const policy = new AccountCreationPolicy();
  const pendingModel = {
    create: jest.fn().mockResolvedValue(undefined),
    findOneAndUpdate: jest.fn(),
  };
  const counterModel = {
    findOneAndUpdate: jest.fn().mockResolvedValue({ mailedCodes: 1 }),
  };

  const userModel = {
    findOne: jest.fn().mockResolvedValue(null),
    exists: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue([MOCK_USER]),
  };

  const configService = new ConfigService(CONFIG_VALUES);

  const authMailService = {
    sendMagicLink: jest.fn().mockResolvedValue(true),
  };

  const signInService = {
    completeSignIn: jest
      .fn()
      .mockResolvedValue({ requiresTwoFactor: false, user: MOCK_USER_SUMMARY }),
    issueSession: jest.fn().mockResolvedValue(MOCK_USER_SUMMARY),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MagicLinkService,
      { provide: AccountCreationPolicy, useValue: policy },
      {
        provide: UnitOfWorkRunner,
        useValue: new MongoUnitOfWorkRunner(createConnectionMock()),
      },
      { provide: MagicLinkStore, useClass: MongoMagicLinkStore },
      { provide: MagicLinkAccounts, useClass: MongoMagicLinkAccounts },
      { provide: MagicLinkSignIn, useClass: MongoMagicLinkSignIn },
      {
        provide: getModelToken(PendingMagicLink.name),
        useValue: pendingModel,
      },
      { provide: getModelToken(MailCounter.name), useValue: counterModel },
      { provide: getModelToken(User.name), useValue: userModel },
      { provide: ConfigService, useValue: configService },
      { provide: AuthMailService, useValue: authMailService },
      {
        provide: MailDispatcherService,
        useValue: new MailDispatcherService(
          configService,
          partialMock<MailService>({}),
        ),
      },
      { provide: SignInService, useValue: signInService },
      MagicLinkBrowserService,
      SessionCookieService,
      {
        provide: Sessions,
        useValue: partialMock<Sessions>({
          validateSessionWithoutExtendingIdle: () => Promise.resolve(null),
        }),
      },
      { provide: Clock, useValue: clock },
    ],
  }).compile();

  return {
    service: module.get<MagicLinkService>(MagicLinkService),
    clock,
    policy,
    pendingModel,
    counterModel,
    userModel,
    authMailService,
    signInService,
  };
}

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MailDispatcherService } from '../../../../mail/mail-dispatcher.service';
import { Types } from 'mongoose';
import { AccountLinkingService } from '../../../services/account-linking.service';
import { User } from '../schemas/user.schema';
import { EMAIL_PROVIDER } from '../../../../common/constants/oauth-providers';
import { OAuthProfile } from '../../../../auth/oauth/oauth-provider.interface';
import { MONGO_LINKED_ACCOUNT_STORE } from '../mongo-linked-account-stores';
import {
  MONGO_ACCOUNT_PROFILE_STORE,
  MONGO_SIGN_IN_METHOD_STORE,
} from '../mongo-account-stores';
import { Role } from '../../../../role/persistence/mongo/schemas/role.schema';
import { Passkey } from '../../../../auth/passkeys/persistence/mongo/schemas/passkey.schema'; // feature:passkeys
import { UnitOfWorkRunner } from '../../../../common/persistence/unit-of-work';
import { MongoUnitOfWorkRunner } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { createModelMock } from '../../../../common/testing/test-doubles.harness-spec';
import { SignInMethodRule } from '../../../services/sign-in-method.rule';
import { ConfigService } from '@nestjs/config';
import { AuthFeaturesService } from '../../../../auth/services/features/auth-features.service';
import { UserRole } from '../../../enums/user-role.enum';
import {
  securityNoticeProviders,
  stubSmtpBoundary,
} from '../../../../../test/utils/security-notice-fixture';

/**
 * Shared setup for the AccountLinkingService specs.
 * The file ends in -spec.ts rather than .spec.ts: the build excludes it and
 * jest does not collect it as a suite of its own.
 */

export interface LinkedAccount {
  provider: string;
  providerId: string;
  linkedAt: Date;
}

export interface MockUser {
  _id: Types.ObjectId;
  email: string;
  name: string;
  role: string;
  isVerified: boolean;
  isDeleted: boolean;
  authProvider: string;
  primaryProvider?: string;
  linkedAccounts: LinkedAccount[];
  linkedProviders: string[];
  save: jest.Mock;
}

export interface AccountLinkingHarness {
  service: AccountLinkingService;
  close: () => Promise<void>;
  /** Makes findById resolve to this user, for both the plain and select paths. */
  resolveUser: (user: MockUser | null) => void;
}

export const USER_ID = new Types.ObjectId().toString();

export const GOOGLE_PROFILE: OAuthProfile = {
  providerId: 'google-123',
  email: 'user@example.com',
  emailVerified: true,
  name: 'Test User',
};

/** Builds a user whose linkedProviders virtual matches its linkedAccounts. */
export function buildUser(overrides: Partial<MockUser> = {}): MockUser {
  const linkedAccounts = overrides.linkedAccounts ?? [];

  return {
    _id: new Types.ObjectId(USER_ID),
    email: 'user@example.com',
    name: 'Test User',
    role: UserRole.USER,
    isVerified: true,
    isDeleted: false,
    authProvider: EMAIL_PROVIDER,
    linkedAccounts,
    linkedProviders: [
      EMAIL_PROVIDER,
      ...linkedAccounts.map((account) => account.provider),
    ],
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

export function linkedAccount(provider: string): LinkedAccount {
  return {
    provider,
    providerId: `${provider}-1`,
    linkedAt: new Date(),
  };
}

export async function createHarness(): Promise<AccountLinkingHarness> {
  const restoreSmtp = stubSmtpBoundary();
  const config = new ConfigService({
    smtp: { from: 'security-notice@example.test' },
    mail: { maxPendingSends: 4, drainDeadlineMs: 250 },
  });
  const userModel = {
    findById: jest.fn(),
    // The fence every unlink passes.
    updateOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    }),
  };
  // feature:passkeys:start
  const passkeyModel = {
    countDocuments: jest.fn().mockReturnValue({
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(0),
    }),
  };
  // feature:passkeys:end
  const roleModel = {
    findOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ permissions: [] }),
    }),
  };
  // A driver session whose transaction commits.
  const session = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
    inTransaction: jest.fn().mockReturnValue(true),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AccountLinkingService,
      MONGO_LINKED_ACCOUNT_STORE,
      MONGO_ACCOUNT_PROFILE_STORE,
      SignInMethodRule,
      MONGO_SIGN_IN_METHOD_STORE,
      // The switches at their defaults: password sign-in on, magic links off.
      {
        provide: AuthFeaturesService,
        useValue: new AuthFeaturesService(config),
      },
      { provide: ConfigService, useValue: config },
      {
        provide: UnitOfWorkRunner,
        useValue: new MongoUnitOfWorkRunner(
          createModelMock<
            ConstructorParameters<typeof MongoUnitOfWorkRunner>[0]
          >({ startSession: jest.fn().mockResolvedValue(session) }),
        ),
      },
      { provide: getModelToken(User.name), useValue: userModel },
      { provide: getModelToken(Role.name), useValue: roleModel },
      { provide: getModelToken(Passkey.name), useValue: passkeyModel }, // feature:passkeys
      ...securityNoticeProviders(config),
    ],
  }).compile();

  return {
    service: module.get<AccountLinkingService>(AccountLinkingService),
    close: async () => {
      try {
        await module.get(MailDispatcherService).flush();
        await module.close();
      } finally {
        restoreSmtp();
      }
    },
    resolveUser: (user: MockUser | null) => {
      userModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(user),
      });
    },
  };
}

import { browserApplicationsForTest } from '../../../common/testing/browser-applications.harness-spec';
import { noRequiredRelyingParties } from './browser-passkey-policy.harness-spec';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { PasskeyManagementService } from './passkey-management.service';
import { MongoPasskeyStore } from '../persistence/mongo/mongo-passkey.store';
import { MongoUnitOfWorkRunner } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { MongoSignInMethodStore } from '../../../user/persistence/mongo/mongo-sign-in-method.store';
import { SignInMethodRule } from '../../../user/services/sign-in-method.rule';
import { createModelMock } from '../../../common/testing/test-doubles.harness-spec';
import {
  createMockPasskey,
  createPasskeyConfig,
  MockPasskey,
  PASSKEY_ID,
  USER_ID,
} from '../persistence/mongo/passkeys.harness-spec';

type Recorded = 'delete' | 'commit';

function transactionSession(recorded: Recorded[]): Record<string, jest.Mock> {
  return {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockImplementation(() => {
      recorded.push('commit');
      return Promise.resolve();
    }),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
    inTransaction: jest.fn().mockReturnValue(true),
  };
}

interface AccountState {
  passkeyCount?: number;
  password?: string;
  linkedAccounts?: { provider: string; providerId: string }[];
  passwordEnabled?: boolean;
  magicLinkEnabled?: boolean;
  /** null stands for an id that belongs to nobody the caller can see. */
  passkey?: MockPasskey | null;
}

interface Harness {
  service: PasskeyManagementService;
  passkeyModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    countDocuments: jest.Mock;
    deleteOne: jest.Mock;
  };
  passkey: MockPasskey;
  recorded: Recorded[];
}

function createHarness(state: AccountState = {}): Harness {
  const passkey =
    state.passkey === undefined ? createMockPasskey() : state.passkey;
  const recorded: Recorded[] = [];

  const passkeyModel = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockResolvedValue([createMockPasskey()]),
    }),
    findOne: jest.fn().mockResolvedValue(passkey),
    countDocuments: jest.fn().mockReturnValue({
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(state.passkeyCount ?? 1),
    }),
    updateMany: jest
      .fn()
      .mockResolvedValue({ matchedCount: state.passkeyCount ?? 1 }),
    deleteOne: jest.fn().mockImplementation(() => {
      recorded.push('delete');
      return { session: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
    }),
  };

  const userModel = {
    updateOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    }),
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({
        _id: USER_ID,
        password: state.password,
        linkedAccounts: state.linkedAccounts ?? [],
      }),
    }),
  };

  const features: Record<string, boolean> = {
    'auth.passwordEnabled': state.passwordEnabled ?? true,
    'magicLink.enabled': state.magicLinkEnabled ?? false,
  };

  const config = Object.assign(new ConfigService(), {
    get: jest.fn((key: string, fallback?: boolean) =>
      key in features ? features[key] : fallback,
    ),
  });
  const browserApplications = browserApplicationsForTest(config);
  const authFeaturesService = new AuthFeaturesService(
    config,
    browserApplications,
  );

  return {
    service: new PasskeyManagementService(
      new MongoPasskeyStore(
        createModelMock<ConstructorParameters<typeof MongoPasskeyStore>[0]>(
          passkeyModel,
        ),
      ),
      new SignInMethodRule(
        new MongoSignInMethodStore(
          createModelMock<
            ConstructorParameters<typeof MongoSignInMethodStore>[0]
          >(userModel),
          createModelMock<
            ConstructorParameters<typeof MongoSignInMethodStore>[1]
          >(passkeyModel),
        ),
        authFeaturesService,
      ),
      new MongoUnitOfWorkRunner(
        createModelMock<ConstructorParameters<typeof MongoUnitOfWorkRunner>[0]>(
          {
            startSession: jest
              .fn()
              .mockResolvedValue(transactionSession(recorded)),
          },
        ),
      ),
      createPasskeyConfig(),
      browserApplications,
      noRequiredRelyingParties(),
    ),
    passkeyModel,
    passkey: passkey ?? createMockPasskey(),
    recorded,
  };
}

const USER = USER_ID.toString();
const ID = PASSKEY_ID.toString();

describe('PasskeyManagementService', () => {
  describe('list', () => {});

  describe('rename', () => {});

  describe('remove', () => {
    it('should keep the last web passkey when the other passkey belongs to an app', async () => {
      const harness = createHarness({
        passkeyCount: 2,
        passwordEnabled: false,
      });
      // Two passkeys on the account; the web scope's count finds this one.
      harness.passkeyModel.countDocuments.mockImplementation(
        (filter: Record<string, unknown>) => ({
          session: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue('$or' in filter ? 1 : 2),
        }),
      );

      await expect(harness.service.remove(USER, ID)).rejects.toMatchObject({
        code: ErrorCode.PASSKEY_LAST_SIGN_IN_METHOD,
        status: 409,
      });
      expect(harness.passkeyModel.deleteOne).not.toHaveBeenCalled();
      expect(harness.recorded).toEqual([]);
    });

    // feature:email-password:start
    // feature:email-password:end

    // feature:magic-link:start
    // feature:magic-link:end
  });
});

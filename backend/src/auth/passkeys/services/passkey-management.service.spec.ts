import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { PasskeyManagementService } from './passkey-management.service';
import { MongoPasskeyStore } from '../persistence/mongo/mongo-passkey.store';
import { MongoUnitOfWorkRunner } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { MongoSignInMethodStore } from '../../../user/persistence/mongo/mongo-sign-in-method.store';
import { SignInMethodRule } from '../../../user/services/sign-in-method.rule';
import { SecurityNoticeService } from '../../../user/services/security-notice.service';
import { SECURITY_NOTICE } from '../../../user/constants/security-notice.constants';
import type { SecurityNotice } from '../../../user/types/security-notice.type';
import {
  createModelMock,
  partialMock,
} from '../../../common/testing/test-doubles.harness-spec';
import {
  createMockPasskey,
  createPasskeyConfig,
  MockPasskey,
  PASSKEY_ID,
  USER_ID,
} from '../persistence/mongo/passkeys.harness-spec';

/** A delete, a commit and a notice, in the order the removal made them. */
type Recorded =
  'delete' | 'commit' | { userId: string; notice: SecurityNotice };

/** A driver session whose transaction commits. */
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
  /** Passkeys on the account, this one included. */
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

  const authFeaturesService = new AuthFeaturesService(
    Object.assign(new ConfigService(), {
      get: jest.fn((key: string, fallback?: boolean) =>
        key in features ? features[key] : fallback,
      ),
    }),
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
      partialMock<SecurityNoticeService>({
        defer: (userId, notice) => {
          recorded.push({ userId, notice });
        },
      }),
    ),
    passkeyModel,
    passkey: passkey ?? createMockPasskey(),
    recorded,
  };
}

const USER = USER_ID.toString();
const ID = PASSKEY_ID.toString();

describe('PasskeyManagementService', () => {
  describe('list', () => {
    it('should return the summaries without key material', async () => {
      const result = await createHarness().service.list(USER);

      expect(result.data.passkeys).toEqual([
        {
          id: ID,
          name: 'Test key',
          deviceType: 'multiDevice',
          backedUp: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          lastUsedAt: null,
        },
      ]);
    });
  });

  describe('rename', () => {
    it('should store the trimmed name', async () => {
      const harness = createHarness();

      const result = await harness.service.rename(USER, ID, {
        name: '  Work laptop  ',
      });

      expect(result.data.name).toBe('Work laptop');
      expect(harness.passkey.save).toHaveBeenCalled();
    });

    it('should scope the lookup to the signed-in account', async () => {
      const harness = createHarness();

      await harness.service.rename(USER, ID, { name: 'Work laptop' });

      expect(harness.passkeyModel.findOne).toHaveBeenCalledWith({
        _id: ID,
        user: USER,
      });
    });

    it('should report a passkey on another account as not found', async () => {
      const harness = createHarness({ passkey: null });

      await expect(
        harness.service.rename(USER, ID, { name: 'Work laptop' }),
      ).rejects.toMatchObject({
        code: ErrorCode.PASSKEY_NOT_FOUND,
        status: 404,
      });
    });
  });

  describe('remove', () => {
    it('should report a passkey on another account as not found', async () => {
      const harness = createHarness({ passkey: null });

      await expect(harness.service.remove(USER, ID)).rejects.toMatchObject({
        code: ErrorCode.PASSKEY_NOT_FOUND,
        status: 404,
      });
      expect(harness.passkeyModel.deleteOne).not.toHaveBeenCalled();
      expect(harness.recorded).toEqual([]);
    });

    it('should remove one of several passkeys', async () => {
      const harness = createHarness({
        passkeyCount: 2,
        passwordEnabled: false,
      });

      const result = await harness.service.remove(USER, ID);

      expect(result.data.message).toBe('Passkey removed');
      expect(harness.passkeyModel.deleteOne).toHaveBeenCalledWith({
        _id: PASSKEY_ID,
      });
    });

    it('should send one removed-passkey notice after the removal commits', async () => {
      const harness = createHarness({
        passkeyCount: 2,
        passwordEnabled: false,
      });

      await harness.service.remove(USER, ID);

      expect(harness.recorded).toEqual([
        'delete',
        'commit',
        { userId: USER, notice: SECURITY_NOTICE.PASSKEY_REMOVED },
      ]);
    });

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

    it('should keep the last passkey when it is the only way in', async () => {
      const harness = createHarness({
        passkeyCount: 1,
        password: undefined,
        linkedAccounts: [],
        passwordEnabled: true,
        magicLinkEnabled: false,
      });

      await expect(harness.service.remove(USER, ID)).rejects.toMatchObject({
        code: ErrorCode.PASSKEY_LAST_SIGN_IN_METHOD,
        status: 409,
      });
      expect(harness.passkeyModel.deleteOne).not.toHaveBeenCalled();
      expect(harness.recorded).toEqual([]);
    });

    // feature:email-password:start
    it('should remove the last passkey when the account has a password', async () => {
      const harness = createHarness({ passkeyCount: 1, password: 'hashed' });

      await harness.service.remove(USER, ID);

      expect(harness.passkeyModel.deleteOne.mock.calls).toEqual([
        [{ _id: PASSKEY_ID }],
      ]);
    });
    // feature:email-password:end

    it('should keep the last passkey when password sign-in is off', async () => {
      const harness = createHarness({
        passkeyCount: 1,
        password: 'hashed',
        passwordEnabled: false,
      });

      await expect(harness.service.remove(USER, ID)).rejects.toMatchObject({
        code: ErrorCode.PASSKEY_LAST_SIGN_IN_METHOD,
      });
    });

    it('should remove the last passkey when a provider is linked', async () => {
      const harness = createHarness({
        passkeyCount: 1,
        passwordEnabled: false,
        linkedAccounts: [{ provider: 'google', providerId: '1' }],
      });

      await harness.service.remove(USER, ID);

      expect(harness.passkeyModel.deleteOne.mock.calls).toEqual([
        [{ _id: PASSKEY_ID }],
      ]);
    });

    // feature:magic-link:start
    it('should remove the last passkey when magic links are on', async () => {
      const harness = createHarness({
        passkeyCount: 1,
        passwordEnabled: false,
        magicLinkEnabled: true,
      });

      await harness.service.remove(USER, ID);

      expect(harness.passkeyModel.deleteOne.mock.calls).toEqual([
        [{ _id: PASSKEY_ID }],
      ]);
    });
    // feature:magic-link:end
  });
});

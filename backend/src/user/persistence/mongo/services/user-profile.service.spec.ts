import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Clock } from '../../../../common/services/clock';
import { HashService } from '../../../../common/services/hash.service';
import { ConfigService } from '@nestjs/config';
import { UserProfileService } from '../../../services/user-profile.service';
import { User } from '../schemas/user.schema';
import { UserRole } from '../../../enums/user-role.enum';
import { AuthProvider } from '../../../enums/auth-provider.enum';
import { Role } from '../../../../role/persistence/mongo/schemas/role.schema';
import { Passkey } from '../../../../auth/passkeys/persistence/mongo/schemas/passkey.schema'; // feature:passkeys
import { SessionService } from '../../../../auth/persistence/mongo/session.service';
import { AppException } from '../../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../../common/enums/error-code.enum';

import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import { UnitOfWorkRunner } from '../../../../common/persistence/unit-of-work';
import { MongoUnitOfWorkRunner } from '../../../../session/persistence/mongo/mongo-unit-of-work';
import { recordedAccountSessions } from '../../../../../test/utils/user/recorded-account-sessions';
import {
  MONGO_ACCOUNT_PERMISSION_STORE,
  MONGO_ACCOUNT_PROFILE_STORE,
} from '../mongo-account-stores';

jest.mock('bcrypt');

describe('UserProfileService', () => {
  let service: UserProfileService;

  const mockUserId = new Types.ObjectId().toString();
  const mockSessionId = new Types.ObjectId().toString();

  const mockUser = {
    _id: new Types.ObjectId(mockUserId),
    email: 'user@example.com',
    name: 'Test User',
    role: UserRole.USER,
    password: 'hashedPassword',
    isVerified: true,
    isDeleted: false,
    googleId: null,
    facebookId: null,
    save: jest.fn().mockResolvedValue(true),
  };

  const mockUserModel = {
    findById: jest.fn(),
  };

  const mockRoleModel = {
    findOne: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ permissions: [] }),
    }),
  };

  // feature:passkeys:start
  const mockPasskeyModel = {
    countDocuments: jest.fn().mockResolvedValue(0),
  };
  // feature:passkeys:end

  const mockSessionService = {
    invalidateAllSessions: jest.fn().mockResolvedValue(1),
    invalidateAllSessionsExceptSession: jest.fn().mockResolvedValue(1),
  };

  const mockConnection = {
    startSession: jest.fn().mockResolvedValue({
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
      inTransaction: jest.fn().mockReturnValue(true),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserProfileService,
        {
          provide: HashService,
          useValue: new HashService(
            new ConfigService({ bcrypt: { rounds: 4 } }),
          ),
        },
        MONGO_ACCOUNT_PROFILE_STORE,
        MONGO_ACCOUNT_PERMISSION_STORE,
        recordedAccountSessions(mockSessionService),
        { provide: UnitOfWorkRunner, useClass: MongoUnitOfWorkRunner },
        { provide: Clock, useValue: new FrozenClock(TEST_NOW) },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(Role.name), useValue: mockRoleModel },
        { provide: getModelToken(Passkey.name), useValue: mockPasskeyModel }, // feature:passkeys
        { provide: SessionService, useValue: mockSessionService },
        { provide: getConnectionToken(), useValue: mockConnection },
      ],
    }).compile();

    service = module.get<UserProfileService>(UserProfileService);

    jest.clearAllMocks();
    mockRoleModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ permissions: [] }),
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getProfile', () => {
    beforeEach(() => {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockUser),
      });
    });

    it('should return user profile', async () => {
      const result = await service.getProfile(mockUserId);

      expect(result.success).toBe(true);
      expect(result.data?.email).toBe('user@example.com');
      expect(result.data?.name).toBe('Test User');
    });

    it('should throw error if user not found', async () => {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getProfile(mockUserId)).rejects.toThrow(
        AppException,
      );
    });

    it('should reject a malformed user id', async () => {
      await expect(service.getProfile('not-an-id')).rejects.toMatchObject({
        code: ErrorCode.INVALID_INPUT,
      });
    });
  });

  describe('updateProfile', () => {
    beforeEach(() => {
      mockUserModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...mockUser }),
      });
    });

    it('should update user name', async () => {
      const userToUpdate = {
        ...mockUser,
        save: jest.fn().mockResolvedValue(true),
      };
      mockUserModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(userToUpdate),
      });

      const result = await service.updateProfile(mockUserId, {
        name: 'New Name',
      });

      expect(result.success).toBe(true);
      expect(userToUpdate.save).toHaveBeenCalled();
    });

    it('should throw error if user not found', async () => {
      mockUserModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.updateProfile(mockUserId, { name: 'New Name' }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('changePassword', () => {
    beforeEach(() => {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({
          ...mockUser,
          save: jest.fn().mockResolvedValue(true),
        }),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('newHashedPassword');
    });

    it('should change password successfully', async () => {
      const userToUpdate = {
        ...mockUser,
        save: jest.fn().mockResolvedValue(true),
      };
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(userToUpdate),
      });
      (bcrypt.compare as jest.Mock)
        .mockResolvedValueOnce(true) // current password valid
        .mockResolvedValueOnce(false); // new password is different

      const result = await service.changePassword(
        mockUserId,
        { currentPassword: 'oldPassword', newPassword: 'NewPassword123' },
        mockSessionId,
      );

      expect(result.success).toBe(true);
      expect(userToUpdate.save).toHaveBeenCalled();
      expect(
        mockSessionService.invalidateAllSessionsExceptSession,
      ).toHaveBeenCalledWith(
        expect.anything(),
        mockSessionId,
        expect.anything(),
      );
    });

    it('should throw error if current password is incorrect', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword(
          mockUserId,
          { currentPassword: 'wrongPassword', newPassword: 'NewPassword123' },
          mockSessionId,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CURRENT_PASSWORD });
    });

    it('should throw error if new password is same as current', async () => {
      (bcrypt.compare as jest.Mock)
        .mockResolvedValueOnce(true) // current password valid
        .mockResolvedValueOnce(true); // new password is same

      await expect(
        service.changePassword(
          mockUserId,
          { currentPassword: 'oldPassword', newPassword: 'oldPassword' },
          mockSessionId,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.SAME_PASSWORD });
    });

    it('should refuse an account without a password', async () => {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ ...mockUser, password: undefined }),
      });

      await expect(
        service.changePassword(
          mockUserId,
          { currentPassword: 'oldPassword', newPassword: 'NewPassword123' },
          mockSessionId,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CURRENT_PASSWORD });
    });

    it('should refuse without a current session', async () => {
      await expect(
        service.changePassword(
          mockUserId,
          { currentPassword: 'oldPassword', newPassword: 'NewPassword123' },
          null,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID });
      expect(
        mockSessionService.invalidateAllSessionsExceptSession,
      ).not.toHaveBeenCalled();
    });
  });

  describe('deactivateAccount', () => {
    it('should deactivate account', async () => {
      const userToDeactivate = {
        ...mockUser,
        save: jest.fn().mockResolvedValue(true),
      };
      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(userToDeactivate),
      });

      const result = await service.deactivateAccount(mockUserId);

      expect(result.success).toBe(true);
      expect(userToDeactivate.save).toHaveBeenCalled();
      expect(mockSessionService.invalidateAllSessions).toHaveBeenCalled();
    });

    it('should throw error if user not found', async () => {
      mockUserModel.findById.mockReturnValue({
        session: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.deactivateAccount(mockUserId)).rejects.toThrow(
        AppException,
      );
    });
  });

  describe('getPrimaryProvider', () => {
    it('should return the stored provider', async () => {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest
          .fn()
          .mockResolvedValue({ primaryProvider: AuthProvider.GOOGLE }),
      });

      expect(await service.getPrimaryProvider(mockUserId)).toBe(
        AuthProvider.GOOGLE,
      );
    });

    it('should return undefined when the user is gone', async () => {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });

      expect(await service.getPrimaryProvider(mockUserId)).toBeUndefined();
    });
  });
});

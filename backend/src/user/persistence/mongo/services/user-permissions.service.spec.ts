import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { UserPermissionsService } from '../../../services/user-permissions.service';
import { User } from '../schemas/user.schema';
import { UserRole } from '../../../enums/user-role.enum';
import { ErrorCode } from '../../../../common/enums/error-code.enum';
import { MONGO_ACCOUNT_PERMISSION_STORE } from '../mongo-account-stores';

interface MockUser {
  _id: Types.ObjectId;
  email: string;
  role: string;
  isDeleted: boolean;
  permissions: string[];
  save: jest.Mock;
}

describe('UserPermissionsService', () => {
  let service: UserPermissionsService;

  const mockUserId = new Types.ObjectId().toString();

  const mockUserModel = {
    findById: jest.fn(),
  };

  function stubUser(permissions: string[]): MockUser {
    const user: MockUser = {
      _id: new Types.ObjectId(mockUserId),
      email: 'user@example.com',
      role: UserRole.USER,
      isDeleted: false,
      permissions,
      save: jest.fn().mockResolvedValue(true),
    };

    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(user),
    });

    return user;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserPermissionsService,
        MONGO_ACCOUNT_PERMISSION_STORE,
        { provide: getModelToken(User.name), useValue: mockUserModel },
      ],
    }).compile();

    service = module.get<UserPermissionsService>(UserPermissionsService);
    jest.clearAllMocks();
  });

  describe('getUserPermissions', () => {
    it('should return direct permissions and role', async () => {
      stubUser(['users:read:all']);

      const result = await service.getUserPermissions(mockUserId);

      expect(result.data?.permissions).toEqual(['users:read:all']);
      expect(result.data?.role).toBe(UserRole.USER);
    });

    it('should reject a malformed user id', async () => {
      await expect(
        service.getUserPermissions('not-an-id'),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_INPUT });
    });

    it('should reject a user the store does not find', async () => {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.getUserPermissions(mockUserId),
      ).rejects.toMatchObject({ code: ErrorCode.USER_NOT_FOUND, status: 404 });
    });
  });

  describe('addPermission', () => {
    it('should append a permission', async () => {
      const user = stubUser([]);

      const result = await service.addPermission(mockUserId, 'users:read:all');

      expect(user.permissions).toEqual(['users:read:all']);
      expect(user.save).toHaveBeenCalled();
      expect(result.data?.permissions).toEqual(['users:read:all']);
    });

    it('should reject a permission the user already holds', async () => {
      const user = stubUser(['users:read:all']);

      await expect(
        service.addPermission(mockUserId, 'users:read:all'),
      ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_ALREADY_EXISTS });
      expect(user.save).not.toHaveBeenCalled();
    });
  });

  describe('removePermission', () => {
    it('should drop a permission', async () => {
      const user = stubUser(['users:read:all', 'sessions:read:all']);

      const result = await service.removePermission(
        mockUserId,
        'users:read:all',
      );

      expect(user.permissions).toEqual(['sessions:read:all']);
      expect(user.save).toHaveBeenCalled();
      expect(result.data?.permissions).toEqual(['sessions:read:all']);
    });

    it('should reject a permission the user does not hold', async () => {
      const user = stubUser([]);

      await expect(
        service.removePermission(mockUserId, 'users:read:all'),
      ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_NOT_FOUND });
      expect(user.save).not.toHaveBeenCalled();
    });
  });
});

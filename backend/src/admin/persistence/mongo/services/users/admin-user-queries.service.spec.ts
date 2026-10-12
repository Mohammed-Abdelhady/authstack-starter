import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AdminUserQueriesService } from '../../../../services/users/admin-user-queries.service';
import { AdminUserAccessService } from '../../../../services/users/admin-user-access.service';
import { RoleHierarchyService } from '../../../../../role/services/role-hierarchy.service';
import { User } from '../../../../../user/persistence/mongo/schemas/user.schema';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { Role } from '../../../../../role/persistence/mongo/schemas/role.schema';
import { MONGO_ADMIN_ACCOUNT_STORE } from '../../mongo-admin-stores';

const LEVELS: Record<string, number> = {
  user: 1,
  support: 2,
  manager: 3,
  admin: 4,
  'content-editor': 1,
};

const MANAGER_VISIBLE_SLUGS = ['user', 'support', 'manager', 'content-editor'];

describe('AdminUserQueriesService', () => {
  let service: AdminUserQueriesService;

  const mockUserModel = {
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
  };

  const mockRoleHierarchyService = {
    getLevel: jest.fn((slug: string) => Promise.resolve(LEVELS[slug] ?? 0)),
    getLevelOrFail: jest.fn(),
    getSlugsAtOrBelow: jest.fn().mockResolvedValue(MANAGER_VISIBLE_SLUGS),
  };

  function stubList(roles: string[]): void {
    const users = roles.map((role) => ({
      _id: new Types.ObjectId(),
      email: `${role}@example.com`,
      name: role,
      role,
      permissions: [],
      isVerified: true,
      isDeleted: false,
    }));

    mockUserModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(users),
    });
    mockUserModel.countDocuments.mockResolvedValue(users.length);
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUserQueriesService,
        AdminUserAccessService,
        MONGO_ADMIN_ACCOUNT_STORE,
        { provide: getModelToken(Role.name), useValue: {} },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: RoleHierarchyService, useValue: mockRoleHierarchyService },
      ],
    }).compile();

    service = module.get<AdminUserQueriesService>(AdminUserQueriesService);
    jest.clearAllMocks();
    mockRoleHierarchyService.getSlugsAtOrBelow.mockResolvedValue(
      MANAGER_VISIBLE_SLUGS,
    );
  });

  describe('listUsers (D-16)', () => {
    it('should bound the listing by the slugs at or below the actor level', async () => {
      stubList(['user', 'content-editor']);

      const result = await service.listUsers(
        { page: 1, limit: 10 },
        UserRole.MANAGER,
      );

      expect(mockUserModel.find).toHaveBeenCalledWith({
        role: { $in: MANAGER_VISIBLE_SLUGS },
      });
      expect(result.data?.data.map((user) => user.role)).toContain(
        'content-editor',
      );
    });

    it('should accept a custom role as a filter value', async () => {
      stubList(['content-editor']);

      await service.listUsers(
        { page: 1, limit: 10, role: 'content-editor' },
        UserRole.MANAGER,
      );

      expect(mockUserModel.find).toHaveBeenCalledWith({
        role: 'content-editor',
      });
    });

    it('should ignore a role filter outside the actor reach', async () => {
      stubList([]);

      await service.listUsers(
        { page: 1, limit: 10, role: UserRole.ADMIN },
        UserRole.MANAGER,
      );

      expect(mockUserModel.find).toHaveBeenCalledWith({
        role: { $in: MANAGER_VISIBLE_SLUGS },
      });
    });
  });

  describe('getUserById', () => {
    function stubUser(role: string): void {
      mockUserModel.findById.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          email: 'target@example.com',
          name: 'Target',
          role,
          permissions: [],
          isVerified: true,
          isDeleted: false,
        }),
      });
    }

    it('should read a user holding a custom role', async () => {
      stubUser('content-editor');

      const result = await service.getUserById('id', UserRole.MANAGER);

      expect(result.data?.role).toBe('content-editor');
    });

    it('should keep peers readable', async () => {
      stubUser(UserRole.MANAGER);

      const result = await service.getUserById('id', UserRole.MANAGER);

      expect(result.success).toBe(true);
    });

    it('should refuse a user above the actor level', async () => {
      stubUser(UserRole.ADMIN);

      await expect(
        service.getUserById('id', UserRole.MANAGER),
      ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    });
  });
});

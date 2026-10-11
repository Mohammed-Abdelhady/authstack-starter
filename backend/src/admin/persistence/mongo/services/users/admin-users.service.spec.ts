import { SecurityEventService } from '../../../../../session/persistence/mongo/security-event.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AdminUsersService } from '../../../../services/users/admin-users.service';
import { AdminUserAccessService } from '../../../../services/users/admin-user-access.service';
import { AdminEmailChangeService } from '../../../../services/users/admin-email-change.service';
import { RoleHierarchyService } from '../../../../../role/services/role-hierarchy.service';
import { SessionService } from '../../../../../auth/persistence/mongo/session.service';
import { User } from '../../../../../user/persistence/mongo/schemas/user.schema';
import { Role } from '../../../../../role/persistence/mongo/schemas/role.schema';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { AppException } from '../../../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { createChainableQueryMock } from '../../../../../common/testing/test-doubles.harness-spec';
import { createConnectionMock } from '../../../../../common/persistence/mongo/mongo-test-doubles.harness-spec';
import { UnitOfWorkRunner } from '../../../../../common/persistence/unit-of-work';
import { MongoRoleChangeStore } from '../../../../../role/persistence/mongo/mongo-role-change.store';
import { MongoRoleSweepStore } from '../../../../../role/persistence/mongo/mongo-role-sweep.store';
import { RoleChangeStore } from '../../../../../role/stores/role-change.store';
import { RoleSweepStore } from '../../../../../role/stores/role-sweep.store';
import { MongoUnitOfWorkRunner } from '../../../../../session/persistence/mongo/mongo-unit-of-work';
import { MONGO_ADMIN_ACCOUNT_STORE } from '../../mongo-admin-stores';
import { recordedAccountSessions } from '../../../../../../test/utils/user/recorded-account-sessions';

const LEVELS: Record<string, number> = {
  user: 1,
  support: 2,
  manager: 3,
  admin: 4,
  'content-editor': 1,
  'regional-lead': 3,
};

interface MockUser {
  _id: Types.ObjectId;
  email: string;
  name: string;
  role: string;
  isVerified: boolean;
  isDeleted: boolean;
  deletedAt?: Date;
  permissions: string[];
  save: jest.Mock;
}

function buildUser(role: string, id: Types.ObjectId): MockUser {
  return {
    _id: id,
    email: 'target@example.com',
    name: 'Target User',
    role,
    isVerified: true,
    isDeleted: false,
    permissions: [],
    save: jest.fn().mockResolvedValue(true),
  };
}

/** Every role lookup answers this one, the actor's own role included. */
const STORED_ROLE = {
  _id: new Types.ObjectId(),
  slug: 'content-editor',
  permissions: ['users:update:all'],
};

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  const targetId = new Types.ObjectId();
  const actorObjectId = new Types.ObjectId();
  const actorId = actorObjectId.toString();

  let targetUser: MockUser;
  let actorUser: MockUser;

  const mockUserModel = {
    findById: jest.fn(),
    findOne: jest.fn(),
  };

  const mockRoleModel = {
    findOne: jest.fn().mockReturnValue(createChainableQueryMock(STORED_ROLE)),
    findById: jest.fn().mockReturnValue(createChainableQueryMock(STORED_ROLE)),
  };

  const mockSessionService = {
    invalidateAllSessions: jest.fn().mockResolvedValue(1),
  };

  const mockRoleHierarchyService = {
    getLevel: jest.fn((slug: string) => Promise.resolve(LEVELS[slug] ?? 0)),
    getLevelOrFail: jest.fn((slug: string) => {
      const level = LEVELS[slug];
      if (level === undefined) {
        return Promise.reject(
          new AppException(ErrorCode.ROLE_NOT_FOUND, 'missing', 404),
        );
      }
      return Promise.resolve(level);
    }),
    getSlugsAtOrBelow: jest.fn(),
  };

  const mockEmailChangeService = { apply: jest.fn() };

  function expectTarget(role: string, actorRole = UserRole.ADMIN): MockUser {
    targetUser = buildUser(role, targetId);
    actorUser = buildUser(actorRole, actorObjectId);
    return targetUser;
  }

  beforeEach(async () => {
    targetUser = buildUser(UserRole.USER, targetId);
    actorUser = buildUser(UserRole.ADMIN, actorObjectId);
    mockUserModel.findById.mockImplementation((id: unknown) =>
      createChainableQueryMock(String(id) === actorId ? actorUser : targetUser),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        AdminUserAccessService,
        MONGO_ADMIN_ACCOUNT_STORE,
        { provide: UnitOfWorkRunner, useClass: MongoUnitOfWorkRunner },
        { provide: RoleChangeStore, useClass: MongoRoleChangeStore },
        { provide: RoleSweepStore, useClass: MongoRoleSweepStore },
        recordedAccountSessions(mockSessionService),
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(Role.name), useValue: mockRoleModel },
        { provide: SessionService, useValue: mockSessionService },
        { provide: RoleHierarchyService, useValue: mockRoleHierarchyService },
        { provide: AdminEmailChangeService, useValue: mockEmailChangeService },
        { provide: getConnectionToken(), useValue: createConnectionMock() },
        { provide: SecurityEventService, useValue: { recordMany: jest.fn() } },
      ],
    }).compile();

    service = module.get<AdminUsersService>(AdminUsersService);
    jest.clearAllMocks();
  });

  describe('peer mutations (S-03)', () => {
    it('should refuse to update a user of the same role', async () => {
      const target = expectTarget(UserRole.MANAGER);

      await expect(
        service.updateUser(
          targetId.toString(),
          { name: 'Renamed' },
          actorId,
          UserRole.MANAGER,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
      expect(target.save).not.toHaveBeenCalled();
    });

    it('should refuse to deactivate a user of the same role', async () => {
      expectTarget(UserRole.MANAGER, UserRole.MANAGER);

      await expect(
        service.updateUserStatus(
          targetId.toString(),
          { isActive: false },
          actorId,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
      expect(mockSessionService.invalidateAllSessions).not.toHaveBeenCalled();
    });

    it('should refuse to delete a user of the same role', async () => {
      expectTarget(UserRole.ADMIN, UserRole.ADMIN);

      await expect(
        service.deleteUser(targetId.toString(), actorId),
      ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    });

    it('should refuse to change the role of a user of the same role', async () => {
      expectTarget(UserRole.MANAGER, UserRole.MANAGER);

      await expect(
        service.updateUserRole(
          targetId.toString(),
          { role: UserRole.USER },
          actorId,
          UserRole.MANAGER,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    });

    it('should allow an actor above the target', async () => {
      const target = expectTarget(UserRole.MANAGER);

      const result = await service.updateUserStatus(
        targetId.toString(),
        { isActive: false },
        actorId,
      );

      expect(result.success).toBe(true);
      expect(target.save).toHaveBeenCalled();
      expect(mockSessionService.invalidateAllSessions).toHaveBeenCalled();
    });

    it('should still refuse operations on the actor own account', async () => {
      expectTarget(UserRole.USER);

      await expect(
        service.deleteUser(targetId.toString(), targetId.toString()),
      ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_SELF });
    });
  });

  describe('deleteUser', () => {
    it('should soft delete a user below the actor level', async () => {
      const target = expectTarget(UserRole.USER);

      await service.deleteUser(targetId.toString(), actorId);

      expect(target.isDeleted).toBe(true);
      expect(target.deletedAt).toBeInstanceOf(Date);
      expect(target.save).toHaveBeenCalled();
      expect(mockSessionService.invalidateAllSessions).toHaveBeenCalled();
    });

    it('should refuse a user that is already deleted', async () => {
      const target = expectTarget(UserRole.USER);
      target.isDeleted = true;

      await expect(
        service.deleteUser(targetId.toString(), actorId),
      ).rejects.toMatchObject({ code: ErrorCode.USER_ALREADY_DELETED });
    });
  });

  describe('role assignment (D-16)', () => {
    it('should assign a custom role below the actor level', async () => {
      const target = expectTarget(UserRole.USER);

      const result = await service.updateUserRole(
        targetId.toString(),
        { role: 'content-editor' },
        actorId,
        UserRole.MANAGER,
      );

      expect(result.data?.role).toBe('content-editor');
      expect(target.role).toBe('content-editor');
      expect(mockSessionService.invalidateAllSessions).toHaveBeenCalled();
    });

    it('should refuse a custom role at the actor level', async () => {
      expectTarget(UserRole.USER);

      await expect(
        service.updateUserRole(
          targetId.toString(),
          { role: 'regional-lead' },
          actorId,
          UserRole.MANAGER,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    });

    it('should refuse a role that does not exist', async () => {
      expectTarget(UserRole.USER);

      await expect(
        service.updateUserRole(
          targetId.toString(),
          { role: 'ghost-role' },
          actorId,
          UserRole.ADMIN,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ROLE_NOT_FOUND });
    });

    it('should still refuse the admin role through the API', async () => {
      expectTarget(UserRole.USER);

      await expect(
        service.updateUserRole(
          targetId.toString(),
          { role: UserRole.ADMIN },
          actorId,
          UserRole.ADMIN,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_ROLE_ASSIGNMENT });
    });
  });

  describe('updateUser email change', () => {
    it('should hand an email change to the email change service', async () => {
      expectTarget(UserRole.USER);

      await service.updateUser(
        targetId.toString(),
        { email: 'new@example.com' },
        actorId,
        UserRole.ADMIN,
      );

      expect(mockEmailChangeService.apply).toHaveBeenCalledWith(
        expect.objectContaining({
          id: targetId.toString(),
          email: 'target@example.com',
        }),
        'new@example.com',
        LEVELS.admin,
      );
    });

    it('should not touch the email service when only the name changes', async () => {
      const target = expectTarget(UserRole.USER);

      await service.updateUser(
        targetId.toString(),
        { name: 'Renamed' },
        actorId,
        UserRole.ADMIN,
      );

      expect(mockEmailChangeService.apply).not.toHaveBeenCalled();
      expect(target.name).toBe('Renamed');
    });
  });
});

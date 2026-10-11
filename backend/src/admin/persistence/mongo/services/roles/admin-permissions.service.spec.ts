import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AdminPermissionsService } from '../../../../services/roles/admin-permissions.service';
import { AdminUserAccessService } from '../../../../services/users/admin-user-access.service';
import { RoleHierarchyService } from '../../../../../role/services/role-hierarchy.service';
import { UserPermissionsService } from '../../../../../user/services/user-permissions.service';
import { User } from '../../../../../user/persistence/mongo/schemas/user.schema';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { Role } from '../../../../../role/persistence/mongo/schemas/role.schema';
import { MONGO_ADMIN_ACCOUNT_STORE } from '../../mongo-admin-stores';
import { UnitOfWorkRunner } from '../../../../../common/persistence/unit-of-work';
import { RoleChangeStore } from '../../../../../role/stores/role-change.store';

const LEVELS: Record<string, number> = {
  user: 1,
  support: 2,
  manager: 3,
  admin: 4,
};

describe('AdminPermissionsService (S-03)', () => {
  let service: AdminPermissionsService;

  const targetId = new Types.ObjectId();
  const actorId = new Types.ObjectId().toString();

  const mockUserModel = { findById: jest.fn() };

  const mockRoleHierarchyService = {
    getLevel: jest.fn((slug: string) => Promise.resolve(LEVELS[slug] ?? 0)),
    getLevelOrFail: jest.fn(),
    getSlugsAtOrBelow: jest.fn(),
  };

  const mockUserPermissionsService = {
    getUserPermissions: jest.fn().mockResolvedValue({ success: true }),
    addPermission: jest.fn().mockResolvedValue({ success: true }),
    removePermission: jest.fn().mockResolvedValue({ success: true }),
  };

  /** The acting account as the unit of work reads it, apart from its role. */
  const mockRoleChanges = {
    readActor: jest.fn().mockResolvedValue({
      isDeleted: false,
      roleSlug: UserRole.MANAGER,
      permissions: ['permissions:grant:all', 'users:read:all'],
    }),
    readRoleBySlug: jest.fn().mockResolvedValue(null),
  };
  const runInPlace = {
    run: <Result>(work: (unitOfWork: object) => Promise<Result>) => work({}),
  };

  function stubTarget(role: string): void {
    mockUserModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: targetId,
        email: 'target@example.com',
        role,
        isDeleted: false,
        permissions: [],
      }),
    });
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPermissionsService,
        AdminUserAccessService,
        MONGO_ADMIN_ACCOUNT_STORE,
        { provide: getModelToken(Role.name), useValue: {} },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: RoleHierarchyService, useValue: mockRoleHierarchyService },
        {
          provide: UserPermissionsService,
          useValue: mockUserPermissionsService,
        },
        { provide: UnitOfWorkRunner, useValue: runInPlace },
        { provide: RoleChangeStore, useValue: mockRoleChanges },
      ],
    }).compile();

    service = module.get<AdminPermissionsService>(AdminPermissionsService);
    jest.clearAllMocks();
  });

  it('should refuse to grant to a peer', async () => {
    stubTarget(UserRole.ADMIN);

    await expect(
      service.addPermission(
        targetId.toString(),
        'users:read:all',
        actorId,
        UserRole.ADMIN,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    expect(mockUserPermissionsService.addPermission).not.toHaveBeenCalled();
  });

  it('should refuse to revoke from a peer', async () => {
    stubTarget(UserRole.MANAGER);

    await expect(
      service.removePermission(
        targetId.toString(),
        'users:read:all',
        actorId,
        UserRole.MANAGER,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    expect(mockUserPermissionsService.removePermission).not.toHaveBeenCalled();
  });

  it('should refuse to grant to the actor itself', async () => {
    stubTarget(UserRole.USER);

    await expect(
      service.addPermission(
        targetId.toString(),
        'users:read:all',
        targetId.toString(),
        UserRole.ADMIN,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_SELF });
  });

  it('should grant to a user below the actor level', async () => {
    stubTarget(UserRole.SUPPORT);

    await service.addPermission(
      targetId.toString(),
      'users:read:all',
      actorId,
      UserRole.MANAGER,
    );

    expect(mockUserPermissionsService.addPermission).toHaveBeenCalledWith(
      targetId.toString(),
      'users:read:all',
    );
  });

  it('should refuse to grant a permission the actor does not hold', async () => {
    stubTarget(UserRole.SUPPORT);

    await expect(
      service.addPermission(
        targetId.toString(),
        'users:delete:all',
        actorId,
        UserRole.MANAGER,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, status: 403 });
    expect(mockUserPermissionsService.addPermission).not.toHaveBeenCalled();
  });

  it('should let a peer be read', async () => {
    stubTarget(UserRole.MANAGER);

    await service.getUserPermissions(targetId.toString(), UserRole.MANAGER);

    expect(mockUserPermissionsService.getUserPermissions).toHaveBeenCalledWith(
      targetId.toString(),
    );
  });

  it('should refuse to read a user above the actor level', async () => {
    stubTarget(UserRole.ADMIN);

    await expect(
      service.getUserPermissions(targetId.toString(), UserRole.SUPPORT),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    expect(
      mockUserPermissionsService.getUserPermissions,
    ).not.toHaveBeenCalled();
  });
});

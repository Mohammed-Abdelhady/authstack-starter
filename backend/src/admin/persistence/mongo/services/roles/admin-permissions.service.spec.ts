import { Test, TestingModule } from '@nestjs/testing';
import { AdminPermissionsService } from '../../../../services/roles/admin-permissions.service';
import { AdminUserAccessService } from '../../../../services/users/admin-user-access.service';
import { AdminAccountStore } from '../../../../stores/admin-account.store';
import { RoleHierarchyService } from '../../../../../role/services/role-hierarchy.service';
import { UserPermissionsService } from '../../../../../user/services/user-permissions.service';
import { StoredAccount } from '../../../../../user/stores/stored-account';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { PERMISSION_PERMISSIONS } from '../../../../../common/constants/permissions';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../../../common/persistence/unit-of-work';
import { RoleChangeStore } from '../../../../../role/stores/role-change.store';

const LEVELS: Record<string, number> = {
  user: 1,
  support: 2,
  manager: 3,
  admin: 4,
};

const TARGET_ID = 'target-id';
const ACTOR_ID = 'actor-id';

class TestUnitOfWork extends UnitOfWork {}

describe('AdminPermissionsService (S-03)', () => {
  let service: AdminPermissionsService;
  let target: StoredAccount;

  const mockRoleHierarchyService = {
    getLevel: jest.fn((slug: string) => Promise.resolve(LEVELS[slug] ?? 0)),
    getLevelOrFail: jest.fn(),
    getSlugsAtOrBelow: jest.fn(),
  };

  const mockUserPermissionsService = {
    getUserPermissions: jest.fn().mockResolvedValue({ success: true }),
  };

  const actor: StoredAccount = {
    id: ACTOR_ID,
    email: 'actor@example.test',
    name: 'Actor',
    role: UserRole.MANAGER,
    permissions: [
      PERMISSION_PERMISSIONS.GRANT_ALL,
      PERMISSION_PERMISSIONS.REVOKE_ALL,
      'users:read:all',
    ],
    authProvider: 'email',
    linkedAccounts: [],
    linkedProviders: ['email'],
    isVerified: true,
    isDeleted: false,
    sessionVersion: 0,
    addressGeneration: 0,
    twoFactorEnabled: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  const mockAccountStore = {
    findAccount: jest.fn(() => Promise.resolve(target)),
    readAccount: jest.fn(() => Promise.resolve(actor)),
    takeAccountForChange: jest.fn(() => Promise.resolve(target)),
    savePermissions: jest.fn(
      (
        _unitOfWork: UnitOfWork,
        _account: StoredAccount,
        permissions: string[],
      ) => {
        target = { ...target, permissions };
        return Promise.resolve(target);
      },
    ),
  };

  const mockRoleChanges = {
    readActor: jest.fn().mockResolvedValue({
      isDeleted: false,
      roleSlug: UserRole.MANAGER,
      permissions: [
        PERMISSION_PERMISSIONS.GRANT_ALL,
        PERMISSION_PERMISSIONS.REVOKE_ALL,
        'users:read:all',
      ],
    }),
    readRoleBySlug: jest.fn().mockResolvedValue(null),
    readRoleAuthorityBySlug: jest.fn().mockResolvedValue({
      slug: UserRole.MANAGER,
      permissions: [],
    }),
  };

  const runInPlace = new (class extends UnitOfWorkRunner {
    run<Result>(
      work: (unitOfWork: UnitOfWork) => Promise<Result>,
    ): Promise<Result> {
      return work(new TestUnitOfWork());
    }
  })();

  function stubTarget(role: string, permissions: string[] = []): void {
    target = {
      id: TARGET_ID,
      email: 'target@example.test',
      name: 'Target',
      role,
      permissions,
      authProvider: 'email',
      linkedAccounts: [],
      linkedProviders: ['email'],
      isVerified: true,
      isDeleted: false,
      sessionVersion: 0,
      addressGeneration: 0,
      twoFactorEnabled: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  beforeEach(async () => {
    stubTarget(UserRole.USER);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminPermissionsService,
        AdminUserAccessService,
        { provide: AdminAccountStore, useValue: mockAccountStore },
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
        TARGET_ID,
        'users:read:all',
        ACTOR_ID,
        UserRole.ADMIN,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    expect(mockAccountStore.savePermissions).not.toHaveBeenCalled();
  });

  it('should refuse to revoke from a peer', async () => {
    stubTarget(UserRole.MANAGER);

    await expect(
      service.removePermission(
        TARGET_ID,
        'users:read:all',
        ACTOR_ID,
        UserRole.MANAGER,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    expect(mockAccountStore.savePermissions).not.toHaveBeenCalled();
  });

  it('should refuse to grant to the actor itself', async () => {
    stubTarget(UserRole.USER);
    target = { ...target, id: ACTOR_ID };

    await expect(
      service.addPermission(
        ACTOR_ID,
        'users:read:all',
        ACTOR_ID,
        UserRole.ADMIN,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_SELF });
  });

  it('should grant to a user below the actor level in the authorized unit', async () => {
    stubTarget(UserRole.SUPPORT);

    const response = await service.addPermission(
      TARGET_ID,
      'users:read:all',
      ACTOR_ID,
      UserRole.MANAGER,
    );

    expect(response.data).toEqual({
      userId: TARGET_ID,
      permissions: ['users:read:all'],
    });
    expect(mockAccountStore.savePermissions).toHaveBeenCalledTimes(1);
    expect(mockAccountStore.takeAccountForChange).toHaveBeenCalledWith(
      expect.any(TestUnitOfWork),
      TARGET_ID,
    );
  });

  it('should refuse to grant a permission the actor does not hold', async () => {
    stubTarget(UserRole.SUPPORT);

    await expect(
      service.addPermission(
        TARGET_ID,
        'users:delete:all',
        ACTOR_ID,
        UserRole.MANAGER,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, status: 403 });
    expect(mockAccountStore.savePermissions).not.toHaveBeenCalled();
  });

  it('should remove a direct permission from a user below the actor', async () => {
    stubTarget(UserRole.SUPPORT, ['users:read:all']);

    const response = await service.removePermission(
      TARGET_ID,
      'users:read:all',
      ACTOR_ID,
      UserRole.MANAGER,
    );

    expect(response.data).toEqual({ userId: TARGET_ID, permissions: [] });
    expect(mockAccountStore.savePermissions).toHaveBeenCalledTimes(1);
  });

  it('should refuse to revoke when the actor no longer holds the route permission', async () => {
    stubTarget(UserRole.SUPPORT, ['users:read:all']);
    mockRoleChanges.readActor.mockResolvedValueOnce({
      isDeleted: false,
      roleSlug: UserRole.MANAGER,
      permissions: [PERMISSION_PERMISSIONS.GRANT_ALL],
    });

    await expect(
      service.removePermission(
        TARGET_ID,
        'users:read:all',
        ACTOR_ID,
        UserRole.MANAGER,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
      status: 403,
    });
    expect(mockAccountStore.savePermissions).not.toHaveBeenCalled();
  });

  it('should refuse a grant that is already present on the target', async () => {
    stubTarget(UserRole.SUPPORT, ['users:read:all']);

    await expect(
      service.addPermission(
        TARGET_ID,
        'users:read:all',
        ACTOR_ID,
        UserRole.MANAGER,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PERMISSION_ALREADY_EXISTS });
    expect(mockAccountStore.savePermissions).not.toHaveBeenCalled();
  });

  it('should let a peer be read', async () => {
    stubTarget(UserRole.MANAGER);

    await service.getUserPermissions(TARGET_ID, UserRole.MANAGER);

    expect(mockUserPermissionsService.getUserPermissions).toHaveBeenCalledWith(
      TARGET_ID,
    );
  });

  it('should refuse to read a user above the actor level', async () => {
    stubTarget(UserRole.ADMIN);

    await expect(
      service.getUserPermissions(TARGET_ID, UserRole.SUPPORT),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
    expect(
      mockUserPermissionsService.getUserPermissions,
    ).not.toHaveBeenCalled();
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { RoleService } from '../../role.service';
import { RoleEditService } from '../../services/edit/role-edit.service';
import { Role } from './schemas/role.schema';
import { User } from '../../../user/persistence/mongo/schemas/user.schema';
import { RoleCatalogStore } from '../../stores/role-catalog.store';
import { MongoRoleCatalogStore } from './mongo-role-catalog.store';

interface MockRole {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  isSystemRole: boolean;
  isProtected: boolean;
  level?: number;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
  save: jest.Mock;
}

function buildRole(overrides: Partial<MockRole> = {}): MockRole {
  return {
    _id: new Types.ObjectId(),
    name: 'Content Editor',
    slug: 'content-editor',
    isSystemRole: false,
    isProtected: false,
    level: 1,
    permissions: ['posts:read:all'],
    createdAt: new Date(),
    updatedAt: new Date(),
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('RoleService', () => {
  const actorId = new Types.ObjectId().toString();
  let service: RoleService;

  const mockRoleModel = {
    findOne: jest.fn(),
  };

  const mockRoleEditService = {
    commit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: getModelToken(Role.name), useValue: mockRoleModel },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: RoleEditService, useValue: mockRoleEditService },
        { provide: RoleCatalogStore, useClass: MongoRoleCatalogStore },
      ],
    }).compile();

    service = module.get<RoleService>(RoleService);
    jest.clearAllMocks();
  });

  describe('update (S-15 system role immutability)', () => {
    it('should refuse a rename that would change a system role slug', async () => {
      const support = buildRole({
        name: 'Support',
        slug: 'support',
        isSystemRole: true,
        isProtected: true,
        level: 2,
        permissions: ['users:read:all'],
      });
      mockRoleModel.findOne.mockResolvedValueOnce(support);

      await expect(
        service.update('support', { name: 'Helpdesk' }, actorId),
      ).rejects.toMatchObject({
        code: 'SYSTEM_ROLE_RENAME_FORBIDDEN',
        status: 403,
      });
      expect(support.save).not.toHaveBeenCalled();
    });

    it('should accept a rename that leaves the system role slug alone', async () => {
      const support = buildRole({
        name: 'Support',
        slug: 'support',
        isSystemRole: true,
        isProtected: true,
        level: 2,
        permissions: ['users:read:all'],
      });
      mockRoleModel.findOne.mockResolvedValueOnce(support);
      mockRoleEditService.commit.mockResolvedValueOnce({
        role: buildRole({ name: 'Support', slug: 'support' }),
        usersMoved: 0,
        previousSlug: 'support',
        nextSlug: 'support',
        renamed: false,
      });

      const result = await service.update(
        'support',
        { name: 'SUPPORT' },
        actorId,
      );

      expect(result.slug).toBe('support');
      expect(result.usersMoved).toBe(0);
      expect(mockRoleEditService.commit).toHaveBeenCalled();
    });
  });

  // Failure: an edit strips the admin role of what the accounts that run the system hold.
  describe('update (R7 the admin role is fixed)', () => {
    it.each([
      [{ name: 'Admin' }],
      [{ description: 'Runs the system' }],
      [{ permissions: ['*', 'reports:read:all'] }],
      [{ level: 4 }],
    ])('should refuse %j on the admin role', async (dto) => {
      const admin = buildRole({
        name: 'Admin',
        slug: 'admin',
        isSystemRole: true,
        isProtected: true,
        level: 4,
        permissions: ['*'],
      });
      mockRoleModel.findOne.mockResolvedValueOnce(admin);

      await expect(service.update('admin', dto, actorId)).rejects.toMatchObject(
        { code: 'ROLE_PROTECTED', status: 403 },
      );
      expect(mockRoleEditService.commit).not.toHaveBeenCalled();
    });
  });

  describe('name and permission refusals', () => {
    it('should refuse to create a role whose name is taken', async () => {
      mockRoleModel.findOne.mockResolvedValueOnce(buildRole());

      await expect(
        service.create(
          { name: 'Content Editor', permissions: ['posts:read:all'] },
          actorId,
        ),
      ).rejects.toMatchObject({ code: 'ROLE_NAME_TAKEN', status: 409 });
    });

    it('should refuse a rename onto the name of another role', async () => {
      const role = buildRole();
      mockRoleModel.findOne.mockResolvedValueOnce(role);
      mockRoleModel.findOne.mockResolvedValueOnce(
        buildRole({ name: 'Content Lead', slug: 'content-lead' }),
      );

      await expect(
        service.update('content-editor', { name: 'Content Lead' }, actorId),
      ).rejects.toMatchObject({ code: 'ROLE_NAME_TAKEN', status: 409 });
      expect(role.save).not.toHaveBeenCalled();
    });

    it('should refuse to create a role with a malformed permission', async () => {
      mockRoleModel.findOne.mockResolvedValueOnce(null);

      await expect(
        service.create(
          { name: 'Auditor', permissions: ['not a permission'] },
          actorId,
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_PERMISSION_FORMAT',
        status: 400,
      });
    });
  });

  describe('update (D-01 rename cascade)', () => {
    it('should move users onto the new slug and report the count', async () => {
      const role = buildRole();
      mockRoleModel.findOne.mockResolvedValueOnce(role);
      mockRoleModel.findOne.mockResolvedValueOnce(null);
      mockRoleEditService.commit.mockResolvedValueOnce({
        role: buildRole({ name: 'Content Lead', slug: 'content-lead' }),
        usersMoved: 3,
        previousSlug: 'content-editor',
        nextSlug: 'content-lead',
        renamed: true,
      });

      const result = await service.update(
        'content-editor',
        {
          name: 'Content Lead',
        },
        actorId,
      );

      expect(result.slug).toBe('content-lead');
      expect(result.usersMoved).toBe(3);
      expect(mockRoleEditService.commit).toHaveBeenCalled();
    });

    it('should leave users alone when the slug does not change', async () => {
      const role = buildRole();
      mockRoleModel.findOne.mockResolvedValueOnce(role);

      mockRoleEditService.commit.mockResolvedValueOnce({
        role,
        usersMoved: 0,
        renamed: false,
      });
      const result = await service.update(
        'content-editor',
        {
          description: 'Writes and edits posts',
        },
        actorId,
      );

      expect(result.usersMoved).toBe(0);
      expect(mockRoleEditService.commit).toHaveBeenCalled();
    });
  });
});

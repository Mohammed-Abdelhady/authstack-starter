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

  describe('update (S-15 system role immutability)', () => {});

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

  describe('name and permission refusals', () => {});

  describe('update (D-01 rename cascade)', () => {});
});

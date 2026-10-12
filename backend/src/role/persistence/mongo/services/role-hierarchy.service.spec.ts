import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { RoleHierarchyService } from '../../../services/role-hierarchy.service';
import { Role } from '../schemas/role.schema';
import { User } from '../../../../user/persistence/mongo/schemas/user.schema';
import { RoleCatalogStore } from '../../../stores/role-catalog.store';
import { MongoRoleCatalogStore } from '../mongo-role-catalog.store';
import { ErrorCode } from '../../../../common/enums/error-code.enum';
import { UNKNOWN_ROLE_LEVEL } from '../../../../common/utils/role-hierarchy';

interface RoleRow {
  slug: string;
  level?: number;
}

describe('RoleHierarchyService', () => {
  let service: RoleHierarchyService;

  const mockRoleModel = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  function stubOne(role: RoleRow | null): void {
    mockRoleModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(role),
    });
  }

  function stubAll(roles: RoleRow[]): void {
    mockRoleModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(roles),
    });
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleHierarchyService,
        { provide: getModelToken(Role.name), useValue: mockRoleModel },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: RoleCatalogStore, useClass: MongoRoleCatalogStore },
      ],
    }).compile();

    service = module.get<RoleHierarchyService>(RoleHierarchyService);
    jest.clearAllMocks();
  });

  describe('getLevel', () => {
    it('should read the stored level', async () => {
      stubOne({ slug: 'regional-lead', level: 3 });
      expect(await service.getLevel('regional-lead')).toBe(3);
    });

    it('should fall back to the seed map for documents without a level', async () => {
      stubOne({ slug: 'admin' });
      expect(await service.getLevel('admin')).toBe(4);
    });

    it('should give an unlisted role without a level the custom role level', async () => {
      stubOne({ slug: 'content-editor' });
      expect(await service.getLevel('content-editor')).toBe(1);
    });

    it('should report a missing role as stranded', async () => {
      stubOne(null);
      expect(await service.getLevel('ghost-role')).toBe(UNKNOWN_ROLE_LEVEL);
    });
  });

  describe('getLevelOrFail', () => {
    it('should reject a slug with no role document', async () => {
      stubOne(null);

      await expect(service.getLevelOrFail('ghost-role')).rejects.toMatchObject({
        code: ErrorCode.ROLE_NOT_FOUND,
      });
    });
  });

  describe('getSlugsAtOrBelow', () => {
    it('should keep custom roles and drop anything above the bound', async () => {
      stubAll([
        { slug: 'user', level: 1 },
        { slug: 'content-editor' },
        { slug: 'manager', level: 3 },
        { slug: 'admin', level: 4 },
      ]);

      expect(await service.getSlugsAtOrBelow(3)).toEqual([
        'user',
        'content-editor',
        'manager',
      ]);
    });
  });
});

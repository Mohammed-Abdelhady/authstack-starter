import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { RoleHierarchyService } from '../../../services/role-hierarchy.service';
import { Role } from '../schemas/role.schema';
import { User } from '../../../../user/persistence/mongo/schemas/user.schema';
import { RoleCatalogStore } from '../../../stores/role-catalog.store';
import { MongoRoleCatalogStore } from '../mongo-role-catalog.store';

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
    it('should fall back to the seed map for documents without a level', async () => {
      stubOne({ slug: 'admin' });
      expect(await service.getLevel('admin')).toBe(4);
    });
  });

  describe('getLevelOrFail', () => {});

  describe('getSlugsAtOrBelow', () => {});
});

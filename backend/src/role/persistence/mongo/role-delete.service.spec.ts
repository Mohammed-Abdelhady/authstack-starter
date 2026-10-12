import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types, Model } from 'mongoose';
import { SecurityEventService } from '../../../session/persistence/mongo/security-event.service';
import { RoleDocument } from './schemas/role.schema';
import { UserDocument } from '../../../user/persistence/mongo/schemas/user.schema';
import { RoleService } from '../../role.service';
import { RoleEditService } from '../../services/edit/role-edit.service';
import { Role } from './schemas/role.schema';
import { User } from '../../../user/persistence/mongo/schemas/user.schema';
import {
  partialMock,
  createChainableQueryMock,
} from '../../../common/testing/test-doubles.harness-spec';
import { createConnectionMock } from '../../../common/persistence/mongo/mongo-test-doubles.harness-spec';
import { RoleCatalogStore } from '../../stores/role-catalog.store';
import { MongoRoleCatalogStore } from './mongo-role-catalog.store';
import { mongoRoleEdit } from '../../../../test/utils/role/mongo-role-services';

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

describe('RoleService delete', () => {
  const actorId = new Types.ObjectId().toString();
  let service: RoleService;

  const mockRoleModel = {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    deleteOne: jest
      .fn()
      .mockReturnValue(createChainableQueryMock({ deletedCount: 1 })),
  };

  const mockUserModel = {
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    findById: jest.fn().mockReturnValue(
      createChainableQueryMock({
        role: 'admin',
        permissions: [],
        isDeleted: false,
      }),
    ),
    find: jest.fn().mockReturnValue(createChainableQueryMock([])),
    countDocuments: jest.fn(),
  };

  const mockRoleEditService = {
    delete: jest.fn(),
  };

  beforeEach(async () => {
    mockRoleModel.findOneAndUpdate.mockResolvedValue(
      buildRole({ slug: 'admin', permissions: ['*'] }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: getModelToken(Role.name), useValue: mockRoleModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: RoleEditService, useValue: mockRoleEditService },
        { provide: RoleCatalogStore, useClass: MongoRoleCatalogStore },
      ],
    }).compile();

    service = module.get<RoleService>(RoleService);
    jest.clearAllMocks();
    mockRoleEditService.delete.mockImplementation(
      async (roleId: Types.ObjectId, id: string) => {
        const editor = mongoRoleEdit(
          partialMock<Model<RoleDocument>>(mockRoleModel),
          partialMock<Model<UserDocument>>(mockUserModel),
          createConnectionMock(),
          partialMock<SecurityEventService>({
            recordRoleDeletion: jest.fn().mockResolvedValue(undefined),
            completeRoleDeletionSweep: jest.fn().mockResolvedValue(undefined),
          }),
        );
        await editor.delete(roleId, id);
      },
    );
    mockRoleModel.findById.mockReturnValue(
      createChainableQueryMock(buildRole()),
    );
    mockUserModel.countDocuments.mockReturnValue(createChainableQueryMock(0));
  });

  describe('delete', () => {
    it('should refuse to delete a system role', async () => {
      mockRoleModel.findOne.mockResolvedValueOnce(
        buildRole({
          name: 'Manager',
          slug: 'manager',
          isSystemRole: true,
          isProtected: true,
          level: 3,
        }),
      );

      await expect(service.delete('manager', actorId)).rejects.toMatchObject({
        code: 'ROLE_PROTECTED',
        status: 403,
      });
      expect(mockRoleModel.deleteOne).not.toHaveBeenCalled();
    });

    it('should refuse to delete a protected role', async () => {
      mockRoleModel.findOne.mockResolvedValueOnce(
        buildRole({ isProtected: true }),
      );

      await expect(
        service.delete('content-editor', actorId),
      ).rejects.toMatchObject({
        code: 'ROLE_PROTECTED',
        status: 403,
      });
    });

    it('should refuse to delete a role users still hold and say how many', async () => {
      mockRoleModel.findOne.mockResolvedValueOnce(buildRole());
      mockRoleModel.findOne.mockReturnValue(
        createChainableQueryMock(
          buildRole({ slug: 'admin', permissions: ['*'] }),
        ),
      );
      mockUserModel.countDocuments.mockImplementationOnce(() =>
        createChainableQueryMock(3),
      );

      await expect(
        service.delete('content-editor', actorId),
      ).rejects.toMatchObject({
        code: 'ROLE_HAS_USERS',
        status: 400,
        details: { count: 3 },
      });
      expect(mockRoleModel.deleteOne).not.toHaveBeenCalled();
    });

    it('should answer ROLE_NOT_FOUND for a role that does not exist', async () => {
      mockRoleModel.findOne.mockResolvedValueOnce(null);

      await expect(service.delete('ghost', actorId)).rejects.toMatchObject({
        code: 'ROLE_NOT_FOUND',
        status: 404,
      });
    });

    it('should delete an unused custom role', async () => {
      const role = buildRole();
      mockRoleModel.findOne.mockResolvedValueOnce(role);
      mockRoleModel.findById.mockReturnValue(createChainableQueryMock(role));
      mockRoleModel.findOne.mockReturnValue(
        createChainableQueryMock(
          buildRole({ slug: 'admin', permissions: ['*'] }),
        ),
      );

      mockRoleModel.findById.mockReturnValueOnce(
        createChainableQueryMock(role),
      );
      mockRoleModel.findById.mockReturnValue(createChainableQueryMock(null));
      await service.delete('content-editor', actorId);

      expect(mockRoleModel.deleteOne).toHaveBeenCalledWith(
        { _id: role._id },
        expect.objectContaining({ session: expect.anything() }),
      );
    });
  });
});

import { SecurityEventService } from '../../../../../session/persistence/mongo/security-event.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AdminUserCreateService } from '../../../../services/users/admin-user-create.service';
import { AdminUserAccessService } from '../../../../services/users/admin-user-access.service';
import { User } from '../../../../../user/persistence/mongo/schemas/user.schema';
import { Role } from '../../../../../role/persistence/mongo/schemas/role.schema';
import { AuthProvider } from '../../../../../user/enums/auth-provider.enum';
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
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { HashService } from '../../../../../common/services/hash.service';

interface CreatedDoc extends Record<string, unknown> {
  _id: Types.ObjectId;
  save: jest.Mock;
}

describe('AdminUserCreateService.createUser (D-12)', () => {
  let service: AdminUserCreateService;
  let created: CreatedDoc[];
  let findOne: jest.Mock;

  const createUserDto = {
    email: 'new@example.com',
    name: 'New User',
    password: 'SecureP@ssw0rd',
    role: 'user',
  };

  const mockAccessService = {
    assertCanAssignRole: jest.fn().mockResolvedValue(undefined),
    assertFreshActorCanModify: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    created = [];
    findOne = jest.fn().mockReturnValue(createChainableQueryMock(null));

    const userModel = Object.assign(
      jest.fn((doc: Record<string, unknown>) => {
        const instance: CreatedDoc = {
          ...doc,
          _id: new Types.ObjectId(),
          permissions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          save: jest.fn().mockResolvedValue(undefined),
        };
        created.push(instance);
        return instance;
      }),
      {
        findOne,
        findById: jest
          .fn()
          .mockImplementation(() => createChainableQueryMock(created[0])),
      },
    );

    const roleQuery = createChainableQueryMock({
      _id: new Types.ObjectId(),
      slug: 'user',
    });
    const roleModel = {
      findOne: jest.fn().mockReturnValue(roleQuery),
      findById: jest.fn().mockReturnValue(roleQuery),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUserCreateService,
        {
          provide: HashService,
          useValue: new HashService(
            new ConfigService({ bcrypt: { rounds: 4 } }),
          ),
        },
        MONGO_ADMIN_ACCOUNT_STORE,
        { provide: UnitOfWorkRunner, useClass: MongoUnitOfWorkRunner },
        { provide: RoleChangeStore, useClass: MongoRoleChangeStore },
        { provide: RoleSweepStore, useClass: MongoRoleSweepStore },
        { provide: getConnectionToken(), useValue: createConnectionMock() },
        { provide: SecurityEventService, useValue: { recordMany: jest.fn() } },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Role.name), useValue: roleModel },
        { provide: AdminUserAccessService, useValue: mockAccessService },
      ],
    }).compile();

    service = module.get<AdminUserCreateService>(AdminUserCreateService);
    jest.clearAllMocks();
    mockAccessService.assertCanAssignRole.mockResolvedValue(undefined);
  });

  it('should record email as the provider the account was created with', async () => {
    await service.createUser(
      createUserDto,
      'admin',
      new Types.ObjectId().toString(),
    );

    expect(created).toHaveLength(1);
    expect(created[0].authProvider).toBe(AuthProvider.EMAIL);
    expect(created[0].primaryProvider).toBe(AuthProvider.EMAIL);
    expect(created[0].save).toHaveBeenCalled();
  });

  it('should hash the password instead of storing it', async () => {
    await service.createUser(
      createUserDto,
      'admin',
      new Types.ObjectId().toString(),
    );

    expect(created[0].password).not.toBe(createUserDto.password);
    expect(String(created[0].password)).toMatch(/^\$2[aby]\$/);
    expect(bcrypt.getRounds(String(created[0].password))).toBe(4);
  });

  it('should refuse an address that is already in use', async () => {
    findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ email: 'new@example.com' }),
    });

    await expect(
      service.createUser(
        createUserDto,
        'admin',
        new Types.ObjectId().toString(),
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.EMAIL_ALREADY_EXISTS,
      status: 409,
    });
    expect(created).toHaveLength(0);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AddressLedger } from '../../../src/common/persistence/address-ledger';
import { Clock } from '../../../src/common/services/clock';
import { AccountCreationPolicy } from '../../../src/auth/services/registration/account-creation-policy';
import { AdminUsersService } from '../../../src/admin/services/users/admin-users.service';
import { AdminUserCreateService } from '../../../src/admin/services/users/admin-user-create.service';
import { AdminPermissionsService } from '../../../src/admin/services/roles/admin-permissions.service';
import { UserPermissionsService } from '../../../src/user/services/user-permissions.service';
import { HashService } from '../../../src/common/services/hash.service';
import { AdminUserAccessService } from '../../../src/admin/services/users/admin-user-access.service';
import { AdminEmailChangeService } from '../../../src/admin/services/users/admin-email-change.service';
import { RoleHierarchyService } from '../../../src/role/services/role-hierarchy.service';
import { RoleService } from '../../../src/role/role.service';
import { RoleEditService } from '../../../src/role/services/edit/role-edit.service';
import {
  Role,
  RoleSchema,
} from '../../../src/role/persistence/mongo/schemas/role.schema';
import { User } from '../../../src/user/persistence/mongo/schemas/user.schema';
import { SessionRevoker } from '../../../src/session/revocation/session-revoker';
import { SecurityEventService } from '../../../src/session/persistence/mongo/security-event.service';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../src/session/persistence/mongo/schemas/security-event.schema';
import { partialMock } from '../../../src/common/testing/test-doubles.harness-spec';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { MongoRoleCatalogStore } from '../../../src/role/persistence/mongo/mongo-role-catalog.store';
import { MongoRoleChangeStore } from '../../../src/role/persistence/mongo/mongo-role-change.store';
import { MongoRoleSweepStore } from '../../../src/role/persistence/mongo/mongo-role-sweep.store';
import { RoleCatalogStore } from '../../../src/role/stores/role-catalog.store';
import { RoleChangeStore } from '../../../src/role/stores/role-change.store';
import { RoleSweepStore } from '../../../src/role/stores/role-sweep.store';
import { MongoUnitOfWorkRunner } from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import { MONGO_ADMIN_ACCOUNT_STORE } from '../../../src/admin/persistence/mongo/mongo-admin-stores';
import { MONGO_PASSWORD_SIGN_IN_STORE } from '../../../src/auth/persistence/mongo/mongo-password-sign-in.store';
import {
  MONGO_ACCOUNT_PERMISSION_STORE,
  MONGO_ACCOUNT_SESSIONS,
} from '../../../src/user/persistence/mongo/mongo-account-stores';
import { FrozenClock, TEST_NOW } from '../frozen-clock';
import {
  bootSessionAuthority,
  type SessionAuthorityHarness,
} from '../session-authority-harness';
import { StaffMutationRules } from '../../../src/admin/services/staff-mutations/staff-mutation-rules';
import {
  testLastAdminGuard,
  testStaffMutationRules,
} from './staff-mutation-test-kit';
import { ErasureLock } from '../../../src/auth/contracts/erasure-lock';
import { DisabledErasureLock } from '../../../src/auth/contracts/defaults/disabled-erasure-lock';
import { LastAdminGuard } from '../../../src/admin/services/staff-mutations/last-admin-guard';

export interface AdminAtomicHarness extends SessionAuthorityHarness {
  service: AdminUsersService;
  createService: AdminUserCreateService;
  permissions: AdminPermissionsService;
  roles: RoleService;
  roleModel: Model<Role>;
  events: Model<SecurityEventDocument>;
}

/** The session authority plus the admin and role services on one database. */
export async function bootAdminAtomic(
  mongoUri: string,
): Promise<AdminAtomicHarness> {
  const harness = await bootSessionAuthority(
    mongoUri,
    new FrozenClock(TEST_NOW),
  );
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      { provide: StaffMutationRules, useValue: testStaffMutationRules() },
      { provide: ErasureLock, useClass: DisabledErasureLock },
      { provide: LastAdminGuard, useValue: testLastAdminGuard() },
      AdminUsersService,
      AdminUserCreateService,
      AccountCreationPolicy,
      { provide: AddressLedger, useValue: harness.app.get(AddressLedger) },
      { provide: Clock, useValue: harness.clock },
      AdminPermissionsService,
      UserPermissionsService,
      { provide: HashService, useValue: harness.app.get(HashService) },
      AdminUserAccessService,
      RoleHierarchyService,
      RoleService,
      RoleEditService,
      { provide: RoleCatalogStore, useClass: MongoRoleCatalogStore },
      { provide: RoleChangeStore, useClass: MongoRoleChangeStore },
      { provide: RoleSweepStore, useClass: MongoRoleSweepStore },
      { provide: UnitOfWorkRunner, useClass: MongoUnitOfWorkRunner },
      MONGO_ADMIN_ACCOUNT_STORE,
      MONGO_PASSWORD_SIGN_IN_STORE,
      MONGO_ACCOUNT_SESSIONS,
      MONGO_ACCOUNT_PERMISSION_STORE,
      { provide: getModelToken(User.name), useValue: harness.users },
      {
        provide: getModelToken(Role.name),
        inject: [getConnectionToken()],
        useFactory: (connection: Connection): Model<Role> =>
          connection.model(Role.name, RoleSchema),
      },
      { provide: getConnectionToken(), useValue: harness.connection },
      { provide: SessionRevoker, useValue: harness.app.get(SessionRevoker) },
      {
        provide: SecurityEventService,
        useValue: harness.app.get(SecurityEventService),
      },
      {
        provide: AdminEmailChangeService,
        useValue: partialMock<AdminEmailChangeService>({
          claimPendingIn: jest.fn().mockResolvedValue(undefined),
          assertAddressAvailable: jest.fn().mockResolvedValue(undefined),
          notifyPreviousAddress: jest.fn(),
          sendConfirmation: jest.fn().mockResolvedValue(undefined),
          resend: jest.fn().mockResolvedValue(undefined),
        }),
      },
    ],
  }).compile();

  const roleModel = module.get<Model<Role>>(getModelToken(Role.name));
  await roleModel.init();

  return Object.assign(harness, {
    service: module.get(AdminUsersService),
    createService: module.get(AdminUserCreateService),
    permissions: module.get(AdminPermissionsService),
    roles: module.get(RoleService),
    roleModel,
    events: harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    ),
  });
}

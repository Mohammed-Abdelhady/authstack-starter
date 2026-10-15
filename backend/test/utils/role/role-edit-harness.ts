import { AudiencePolicy } from '../../../src/session/applications/audience-policy';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { RoleService } from '../../../src/role/role.service';
import { RoleEditService } from '../../../src/role/services/edit/role-edit.service';
import {
  Role,
  RoleSchema,
} from '../../../src/role/persistence/mongo/schemas/role.schema';
import { User } from '../../../src/user/persistence/mongo/schemas/user.schema';
import { SecurityEventService } from '../../../src/session/persistence/mongo/security-event.service';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../src/session/persistence/mongo/schemas/security-event.schema';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { MongoRoleCatalogStore } from '../../../src/role/persistence/mongo/mongo-role-catalog.store';
import { MongoRoleChangeStore } from '../../../src/role/persistence/mongo/mongo-role-change.store';
import { MongoRoleSweepStore } from '../../../src/role/persistence/mongo/mongo-role-sweep.store';
import { RoleCatalogStore } from '../../../src/role/stores/role-catalog.store';
import { RoleChangeStore } from '../../../src/role/stores/role-change.store';
import { RoleSweepStore } from '../../../src/role/stores/role-sweep.store';
import { MongoUnitOfWorkRunner } from '../../../src/session/persistence/mongo/mongo-unit-of-work';
import { FrozenClock, TEST_NOW } from '../frozen-clock';
import {
  bootSessionAuthority,
  type SessionAuthorityHarness,
} from '../session-authority-harness';

export interface RoleEditHarness extends SessionAuthorityHarness {
  service: RoleService;
  edit: RoleEditService;
  roleModel: Model<Role>;
  events: Model<SecurityEventDocument>;
}

/** The session authority plus the role edit service on one database. */
export async function bootRoleEdit(mongoUri: string): Promise<RoleEditHarness> {
  const harness = await bootSessionAuthority(
    mongoUri,
    new FrozenClock(TEST_NOW),
  );
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RoleService,
      RoleEditService,
      { provide: AudiencePolicy, useValue: harness.app.get(AudiencePolicy) },
      { provide: RoleCatalogStore, useClass: MongoRoleCatalogStore },
      { provide: RoleChangeStore, useClass: MongoRoleChangeStore },
      { provide: RoleSweepStore, useClass: MongoRoleSweepStore },
      { provide: UnitOfWorkRunner, useClass: MongoUnitOfWorkRunner },
      {
        provide: getModelToken(Role.name),
        inject: [getConnectionToken()],
        useFactory: (connection: Connection): Model<Role> =>
          connection.model(Role.name, RoleSchema),
      },
      { provide: getModelToken(User.name), useValue: harness.users },
      { provide: getConnectionToken(), useValue: harness.connection },
      {
        provide: SecurityEventService,
        useValue: harness.app.get(SecurityEventService),
      },
    ],
  }).compile();

  // An index build still running holds the collection, and an edit that asks
  // for it then is refused and spends one of its attempts.
  const roleModel = module.get<Model<Role>>(getModelToken(Role.name));
  await roleModel.init();

  return Object.assign(harness, {
    service: module.get(RoleService),
    edit: module.get(RoleEditService),
    roleModel,
    events: harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    ),
  });
}

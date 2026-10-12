import { Connection, Model } from 'mongoose';
import { RerunPause } from '../../../common/persistence/unit-of-work';
import { MongoUnitOfWorkRunner } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { SecurityEventService } from '../../../session/persistence/mongo/security-event.service';
import { UserDocument } from '../../../user/persistence/mongo/schemas/user.schema';
import { RoleDocument } from './schemas/role.schema';
import { RoleSweepStores } from '../../sweeps/role-holder-sweep';
import { MongoRoleCatalogStore } from './mongo-role-catalog.store';
import { MongoRoleChangeStore } from './mongo-role-change.store';
import { MongoRoleSweepStore } from './mongo-role-sweep.store';

export interface MongoRoleModels {
  roleModel: Model<RoleDocument>;
  userModel: Model<UserDocument>;
  connection: Connection;
  events: SecurityEventService;
}

export interface MongoRoleStores extends RoleSweepStores {
  catalog: MongoRoleCatalogStore;
}

/** The MongoDB role stores over the given models, wired by hand. */
export function mongoRoleStores(
  models: MongoRoleModels,
  pause?: RerunPause,
): MongoRoleStores {
  const { roleModel, userModel, connection, events } = models;
  return {
    runner: new MongoUnitOfWorkRunner(connection, pause),
    catalog: new MongoRoleCatalogStore(roleModel, userModel),
    changes: new MongoRoleChangeStore(roleModel, userModel, events),
    sweeps: new MongoRoleSweepStore(roleModel, userModel, events),
  };
}

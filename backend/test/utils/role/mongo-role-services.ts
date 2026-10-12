import { Connection, Model } from 'mongoose';
import { Clock } from '../../../src/common/services/clock';
import { mongoRoleStores } from '../../../src/role/persistence/mongo/mongo-role-stores';
import { RoleDocument } from '../../../src/role/persistence/mongo/schemas/role.schema';
import { RoleSweepBootstrapService } from '../../../src/role/services/bootstrap/role-sweep-bootstrap.service';
import { RoleEditService } from '../../../src/role/services/edit/role-edit.service';
import { SecurityEventService } from '../../../src/session/persistence/mongo/security-event.service';
import { UserDocument } from '../../../src/user/persistence/mongo/schemas/user.schema';

/** The startup repair on the MongoDB adapter over the given models. */
export function mongoRoleSweepBootstrap(
  roleModel: Model<RoleDocument>,
  userModel: Model<UserDocument>,
  connection: Connection,
  events: SecurityEventService,
  clock: Clock,
): RoleSweepBootstrapService {
  const stores = mongoRoleStores({ roleModel, userModel, connection, events });
  return new RoleSweepBootstrapService(
    stores.runner,
    stores.changes,
    stores.sweeps,
    clock,
  );
}

/** The role edit service on the MongoDB adapter over the given models. */
export function mongoRoleEdit(
  roleModel: Model<RoleDocument>,
  userModel: Model<UserDocument>,
  connection: Connection,
  events: SecurityEventService,
): RoleEditService {
  const stores = mongoRoleStores({ roleModel, userModel, connection, events });
  return new RoleEditService(stores.runner, stores.changes, stores.sweeps);
}

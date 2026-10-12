import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  User,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { Role, RoleSchema } from './schemas/role.schema';
import { RoleCatalogStore } from '../../stores/role-catalog.store';
import { RoleChangeStore } from '../../stores/role-change.store';
import { RoleSweepStore } from '../../stores/role-sweep.store';
import { MongoRoleCatalogStore } from './mongo-role-catalog.store';
import { MongoRoleChangeStore } from './mongo-role-change.store';
import { MongoRoleSweepStore } from './mongo-role-sweep.store';

export const MONGO_ROLE_MODELS: DynamicModule = MongooseModule.forFeature([
  { name: Role.name, schema: RoleSchema },
  { name: User.name, schema: UserSchema },
]);

export const MONGO_ROLE_PROVIDERS: Provider[] = [
  { provide: RoleCatalogStore, useClass: MongoRoleCatalogStore },
  { provide: RoleChangeStore, useClass: MongoRoleChangeStore },
  { provide: RoleSweepStore, useClass: MongoRoleSweepStore },
];

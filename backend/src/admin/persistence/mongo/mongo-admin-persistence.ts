import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Role,
  RoleSchema,
} from '../../../role/persistence/mongo/schemas/role.schema';
import {
  User,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { MONGO_ADMIN_ACCOUNT_STORE } from './mongo-admin-stores';

export const MONGO_ADMIN_MODELS: DynamicModule = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
  { name: Role.name, schema: RoleSchema },
]);

export const MONGO_ADMIN_PROVIDERS: Provider[] = [MONGO_ADMIN_ACCOUNT_STORE];

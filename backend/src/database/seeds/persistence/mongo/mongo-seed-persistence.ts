import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoleSchema } from '../../../../role/persistence/mongo/schemas/role.schema';
import { UserSchema } from '../../../../user/persistence/mongo/schemas/user.schema';
import { MONGO_SEED_STORE } from './mongo-seed.store';

export const MONGO_SEED_MODELS: DynamicModule = MongooseModule.forFeature([
  {
    name: 'User',
    schema: UserSchema,
  },
  {
    name: 'Role',
    schema: RoleSchema,
  },
]);

export const MONGO_SEED_PROVIDERS: Provider[] = [MONGO_SEED_STORE];

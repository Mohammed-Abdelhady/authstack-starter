import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  User,
  UserSchema,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import { MONGO_PROVIDER_SIGN_IN_STORE } from './mongo-provider-sign-in.store';

export const MONGO_OAUTH_MODELS: DynamicModule = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
]);

export const MONGO_OAUTH_PROVIDERS: Provider[] = [MONGO_PROVIDER_SIGN_IN_STORE];

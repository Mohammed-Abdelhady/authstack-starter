import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  User,
  UserSchema,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import {
  PasskeyChallenge,
  PasskeyChallengeSchema,
} from './schemas/passkey-challenge.schema';
import { Passkey, PasskeySchema } from './schemas/passkey.schema';
import { MONGO_PASSKEY_STORES } from './mongo-passkey-stores';

export const MONGO_PASSKEY_MODELS: DynamicModule = MongooseModule.forFeature([
  { name: Passkey.name, schema: PasskeySchema },
  { name: PasskeyChallenge.name, schema: PasskeyChallengeSchema },
  { name: User.name, schema: UserSchema },
]);

export const MONGO_PASSKEY_PROVIDERS: Provider[] = MONGO_PASSKEY_STORES;

import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
// feature:passkeys:start
import {
  Passkey,
  PasskeySchema,
} from '../../../auth/passkeys/persistence/mongo/schemas/passkey.schema';
// feature:passkeys:end
import {
  Role,
  RoleSchema,
} from '../../../role/persistence/mongo/schemas/role.schema';
import {
  Session,
  SessionSchema,
} from '../../../session/persistence/mongo/schemas/session.schema';
import { User, UserSchema } from './schemas/user.schema';
import { MONGO_ACCOUNT_STORES } from './mongo-account-stores';
import { MONGO_LINKED_ACCOUNT_STORE } from './mongo-linked-account-stores'; // feature:oauth-core

export const MONGO_USER_MODELS: DynamicModule = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
  { name: Session.name, schema: SessionSchema },
  { name: Role.name, schema: RoleSchema },
  // feature:passkeys:start
  // The profile reports how many passkeys the account holds.
  { name: Passkey.name, schema: PasskeySchema },
  // feature:passkeys:end
]);

export const MONGO_USER_PROVIDERS: Provider[] = [
  ...MONGO_ACCOUNT_STORES,
  MONGO_LINKED_ACCOUNT_STORE, // feature:oauth-core
];

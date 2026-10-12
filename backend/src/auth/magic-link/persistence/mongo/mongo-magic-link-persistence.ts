import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Role,
  RoleSchema,
} from '../../../../role/persistence/mongo/schemas/role.schema';
import {
  User,
  UserSchema,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import {
  MailCounter,
  MailCounterSchema,
} from '../../../persistence/mongo/schemas/mail-counter.schema';
import {
  PendingMagicLink,
  PendingMagicLinkSchema,
} from './schemas/pending-magic-link.schema';
import {
  MagicLinkAccounts,
  MagicLinkSignIn,
} from '../../stores/magic-link-accounts';
import { MagicLinkStore } from '../../stores/magic-link.store';
import {
  MongoMagicLinkAccounts,
  MongoMagicLinkSignIn,
} from './mongo-magic-link-accounts';
import { MongoMagicLinkStore } from './mongo-magic-link.store';

export const MONGO_MAGIC_LINK_MODELS: DynamicModule = MongooseModule.forFeature(
  [
    { name: PendingMagicLink.name, schema: PendingMagicLinkSchema },
    { name: MailCounter.name, schema: MailCounterSchema },
    { name: User.name, schema: UserSchema },
    { name: Role.name, schema: RoleSchema },
  ],
);

export const MONGO_MAGIC_LINK_PROVIDERS: Provider[] = [
  { provide: MagicLinkStore, useClass: MongoMagicLinkStore },
  { provide: MagicLinkAccounts, useClass: MongoMagicLinkAccounts },
  { provide: MagicLinkSignIn, useClass: MongoMagicLinkSignIn },
];

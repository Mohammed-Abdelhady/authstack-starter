import { DynamicModule, Provider, Type } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MONGO_ROLE_PERMISSIONS } from '../../../role/persistence/mongo/mongo-role-permissions';
import {
  Role,
  RoleSchema,
} from '../../../role/persistence/mongo/schemas/role.schema';
import {
  Session,
  SessionSchema,
} from '../../../session/persistence/mongo/schemas/session.schema';
import {
  User,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { MailCounter, MailCounterSchema } from './schemas/mail-counter.schema';
import {
  PendingPasswordReset,
  PendingPasswordResetSchema,
} from './schemas/pending-password-reset.schema';
import {
  PendingRegistration,
  PendingRegistrationSchema,
} from './schemas/pending-registration.schema';
import { MONGO_SECOND_FACTOR_STORES } from '../../two-factor/persistence/mongo/mongo-second-factor-stores'; // feature:totp
// feature:totp:start
import {
  TwoFactorChallenge,
  TwoFactorChallengeSchema,
} from '../../two-factor/persistence/mongo/schemas/two-factor-challenge.schema';
// feature:totp:end
import { MONGO_ACTIVATION_STORES } from './mongo-activation-accounts';
import { MONGO_PASSWORD_SIGN_IN_STORE } from './mongo-password-sign-in.store';
import { MONGO_PENDING_CODE_STORES } from './mongo-pending-code-stores';
import { SignInService } from './sign-in.service';

export const MONGO_AUTH_MODELS: DynamicModule = MongooseModule.forFeature([
  { name: PendingRegistration.name, schema: PendingRegistrationSchema },
  { name: PendingPasswordReset.name, schema: PendingPasswordResetSchema },
  { name: MailCounter.name, schema: MailCounterSchema },
  { name: TwoFactorChallenge.name, schema: TwoFactorChallengeSchema }, // feature:totp
  { name: User.name, schema: UserSchema },
  { name: Session.name, schema: SessionSchema },
  { name: Role.name, schema: RoleSchema },
]);

/**
 * The MongoDB face of the sign-in service, for the adapters that hold an
 * account as a document.
 */
export const MONGO_AUTH_BRIDGES: Type[] = [SignInService];

export const MONGO_AUTH_PROVIDERS: Provider[] = [
  ...MONGO_PENDING_CODE_STORES,
  ...MONGO_ACTIVATION_STORES,
  MONGO_PASSWORD_SIGN_IN_STORE,
  MONGO_ROLE_PERMISSIONS,
  ...MONGO_SECOND_FACTOR_STORES, // feature:totp
  ...MONGO_AUTH_BRIDGES,
];

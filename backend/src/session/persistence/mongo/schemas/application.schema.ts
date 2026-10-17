import type { ApplicationSignInMethods } from '../../../applications/types/application-sign-in-methods';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
} from '../../../constants/client-ids';
import {
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../../../constants/session-policy';
import { isAcceptableRedirectUri } from '../../../utils/oauth/redirect-uri.util';
import { SIGN_UP_POLICY } from '../../../../config/constants/host-contracts';
import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../../../host/types/host-role.type';

@Schema({ _id: false })
export class ApplicationPolicy {
  @Prop({ required: true, default: WEB_ABSOLUTE_LIFETIME_MS })
  absoluteLifetimeMs!: number;

  @Prop({ required: true, default: WEB_IDLE_LIFETIME_MS })
  idleLifetimeMs!: number;

  @Prop({ type: Number, min: 1, validate: Number.isSafeInteger })
  unboundAbsoluteLifetimeMs?: number;

  @Prop({ type: Number, min: 1, validate: Number.isSafeInteger })
  unboundIdleLifetimeMs?: number;
}

export const ApplicationPolicySchema =
  SchemaFactory.createForClass(ApplicationPolicy);

@Schema({ timestamps: true, minimize: false })
export class Application {
  @Prop({
    type: String,
    enum: Object.values(SIGN_UP_POLICY),
    default: SIGN_UP_POLICY.OPEN,
  })
  signUp!: (typeof SIGN_UP_POLICY)[keyof typeof SIGN_UP_POLICY];

  @Prop({ default: false })
  requirePasskey!: boolean;

  @Prop({
    type: Object,
    validate: (value: unknown) =>
      value === null || (typeof value === 'object' && !Array.isArray(value)),
  })
  signInMethods?: ApplicationSignInMethods | null;

  @Prop({ type: String, enum: Object.values(ROLE_AUDIENCE) })
  accountAudience?: RoleAudience;

  @Prop({ type: Number, min: 1, validate: Number.isSafeInteger })
  sessionCap?: number;

  @Prop({ required: true })
  clientId!: string;

  @Prop({ required: true })
  displayName!: string;

  @Prop({
    type: String,
    enum: Object.values(APPLICATION_PLATFORM),
    required: true,
  })
  platform!: string;

  @Prop({ required: true })
  environment!: string;

  @Prop({
    type: String,
    enum: Object.values(APPLICATION_CLIENT_TYPE),
    required: true,
  })
  clientType!: string;

  @Prop({ default: true })
  enabled!: boolean;

  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (redirectUris: unknown) =>
        Array.isArray(redirectUris) &&
        Array.from(redirectUris).every((uri) => isAcceptableRedirectUri(uri)),
      message: 'Redirect URIs must be acceptable callback addresses',
    },
  })
  redirectUris!: string[];

  @Prop({ type: [String], default: [] })
  allowedOrigins!: string[];

  @Prop({ type: [String], default: [DEFAULT_API_AUDIENCE] })
  audiences!: string[];

  @Prop({ type: [String], default: [DEFAULT_API_AUDIENCE] })
  allowedScopes!: string[];

  @Prop({ type: ApplicationPolicySchema, default: () => ({}) })
  policy!: ApplicationPolicy;

  @Prop({ type: Number, default: 0 })
  sessionVersion!: number;

  @Prop({ type: Number, default: 0, min: 0, validate: Number.isSafeInteger })
  policyVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ApplicationDocument = HydratedDocument<Application>;

export const ApplicationSchema: MongooseSchema<Application> =
  SchemaFactory.createForClass(Application);

ApplicationSchema.path('policy').validate(
  (policy: ApplicationPolicy | null | undefined) => {
    const absolute = policy?.unboundAbsoluteLifetimeMs;
    const idle = policy?.unboundIdleLifetimeMs;
    if (absolute == null && idle == null) return true;
    return (
      typeof absolute === 'number' &&
      typeof idle === 'number' &&
      Number.isSafeInteger(absolute) &&
      Number.isSafeInteger(idle) &&
      absolute > 0 &&
      idle > 0
    );
  },
  'Unbound session limits must both be positive or both be absent',
);

ApplicationSchema.index(
  { clientId: 1, environment: 1 },
  { unique: true, name: 'application_client_environment_unique' },
);

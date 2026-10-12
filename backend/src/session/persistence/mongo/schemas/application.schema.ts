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

@Schema({ _id: false })
export class ApplicationPolicy {
  @Prop({ required: true, default: WEB_ABSOLUTE_LIFETIME_MS })
  absoluteLifetimeMs!: number;

  @Prop({ required: true, default: WEB_IDLE_LIFETIME_MS })
  idleLifetimeMs!: number;
}

export const ApplicationPolicySchema =
  SchemaFactory.createForClass(ApplicationPolicy);

@Schema({ timestamps: true })
export class Application {
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

  @Prop({ type: Number, default: 0 })
  policyVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ApplicationDocument = HydratedDocument<Application>;

export const ApplicationSchema: MongooseSchema<Application> =
  SchemaFactory.createForClass(Application);

ApplicationSchema.index(
  { clientId: 1, environment: 1 },
  { unique: true, name: 'application_client_environment_unique' },
);

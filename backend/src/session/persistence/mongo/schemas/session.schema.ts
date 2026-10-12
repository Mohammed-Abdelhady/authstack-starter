import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import type { LeanUser } from '../../../../user/persistence/mongo/schemas/user.schema';
import {
  CREDENTIAL_PURPOSE,
  CredentialPurpose,
} from '../../../constants/credential-purpose';
import { DEFAULT_API_AUDIENCE } from '../../../constants/client-ids';
import { AUTH_SCHEMA_VERSION } from '../../../constants/session-policy';

/**
 * Parsed device information from user agent
 */
export class DeviceInfo {
  @Prop({
    type: String,
    enum: ['mobile', 'tablet', 'desktop', 'unknown'],
    default: 'unknown',
  })
  type!: 'mobile' | 'tablet' | 'desktop' | 'unknown';

  @Prop()
  browser?: string; // e.g., "Chrome 120.0"

  @Prop()
  os?: string; // e.g., "Windows 10"

  @Prop()
  name?: string; // Human-readable: "Chrome on Windows"
}

/**
 * Session schema for managing user authentication sessions
 */
@Schema({ timestamps: true })
export class Session {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ required: true })
  tokenHash!: string;

  @Prop({ required: true })
  userAgent!: string;

  @Prop({ type: DeviceInfo })
  device?: DeviceInfo;

  @Prop({ required: true })
  ip!: string;

  @Prop()
  deviceName?: string; // Optional custom device name

  @Prop({ default: true })
  isValid!: boolean;

  @Prop()
  lastUsedAt?: Date;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ required: true, default: AUTH_SCHEMA_VERSION })
  schemaVersion!: number;

  @Prop({ required: true, default: 1 })
  authEpoch!: number;

  @Prop({ required: true })
  clientId!: string;

  @Prop({ type: Number, required: true, default: 0 })
  userVersion!: number;

  @Prop({ type: Number, required: true, default: 0 })
  clientVersion!: number;

  @Prop({ type: Number, required: true, default: 0 })
  grantVersion!: number;

  @Prop({ type: [String], default: [DEFAULT_API_AUDIENCE] })
  scopes!: string[];

  @Prop({ default: DEFAULT_API_AUDIENCE })
  audience!: string;

  @Prop({ type: [String], default: [] })
  authenticationMethods!: string[];

  @Prop({ required: true })
  authenticatedAt!: Date;

  @Prop()
  stepUpAt?: Date;

  @Prop({ required: true })
  idleExpiresAt!: Date;

  @Prop({ required: true })
  lastActivityAt!: Date;

  @Prop({
    type: String,
    enum: Object.values(CREDENTIAL_PURPOSE),
    default: CREDENTIAL_PURPOSE.BROWSER_SESSION,
  })
  credentialPurpose!: CredentialPurpose;

  @Prop()
  proofKeyThumbprint?: string;

  /** Session CSRF secret. Not a credential; the browser reads it back after reload. */
  @Prop()
  csrfToken?: string;

  @Prop()
  revokedAt?: Date;

  @Prop()
  revokedReason?: string;

  @Prop()
  revokedActor?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SessionDocument = HydratedDocument<Session>;

export interface LeanSession extends Omit<Session, 'user'> {
  _id: Types.ObjectId;
  /** The id the session belongs to; authority reads populate it as LeanUser. */
  user: Types.ObjectId | LeanUser;
}

export const SessionSchema: MongooseSchema<Session> =
  SchemaFactory.createForClass(Session);

SessionSchema.index(
  { tokenHash: 1 },
  { unique: true, name: 'tokenHash_unique' },
);
SessionSchema.index(
  { user: 1, isValid: 1, createdAt: -1, _id: 1 },
  { name: 'session_user_active_created' },
);
SessionSchema.index(
  { clientId: 1, isValid: 1 },
  { name: 'session_client_active' },
);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SessionSchema.index({ user: 1, lastUsedAt: -1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { EMAIL_PROVIDER } from '../../../../common/constants/oauth-providers';
import { TwoFactor, TwoFactorSchema } from './two-factor.schema'; // feature:totp

/**
 * One OAuth account linked to a user, keyed by the provider id from the OAuth registry.
 */
@Schema({ _id: false })
export class LinkedAccount {
  @Prop({ required: true })
  provider!: string;

  @Prop({ required: true })
  providerId!: string;

  @Prop({ required: true, default: () => new Date() })
  linkedAt!: Date;
}

export const LinkedAccountSchema = SchemaFactory.createForClass(LinkedAccount);

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ lowercase: true, trim: true })
  pendingEmail?: string;

  @Prop({ select: false })
  password?: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop()
  avatarUrl?: string;

  @Prop({ type: String, default: 'user' })
  role!: string;

  @Prop({ type: [String], default: [] })
  permissions!: string[];

  /** Provider the account was created with: 'email' or an OAuth provider id. */
  @Prop({ type: String, default: EMAIL_PROVIDER })
  authProvider!: string;

  @Prop({ type: [LinkedAccountSchema], default: [] })
  linkedAccounts!: LinkedAccount[];

  @Prop({ default: false })
  isVerified!: boolean;

  @Prop({ default: false })
  isDeleted!: boolean;

  @Prop()
  deletedAt?: Date;

  @Prop({ type: Number, default: 0 })
  sessionVersion!: number;

  @Prop({ type: Number, default: 0 })
  issuanceFence!: number;

  /** A grant writes this so a concurrent loss of authority conflicts. */
  @Prop({ type: Number, select: false })
  grantAuthorityFence?: number;

  /**
   * Bumped each time an admin moves this account to a new address. An
   * email-change code is bound to the generation it was issued under, so a
   * later move cannot be confirmed by an earlier code.
   */
  @Prop({ type: Number, default: 0 })
  addressGeneration!: number;

  @Prop()
  credentialsChangedAt?: Date;

  /** Provider id used as the source of truth for profile sync. */
  @Prop({ type: String })
  primaryProvider?: string;

  @Prop()
  profileSyncedAt?: Date;

  @Prop()
  lastSyncedProvider?: string;

  // feature:totp:start
  /**
   * Second factor state. Optional subdocument, so accounts written before it
   * existed read back with the defaults and need no migration.
   */
  @Prop({ type: TwoFactorSchema, default: () => ({}) })
  twoFactor!: TwoFactor;
  // feature:totp:end

  /**
   * Written by every removal of a way to sign in, so two of them on one
   * account conflict. It carries no meaning of its own.
   */
  @Prop({ type: Number, select: false })
  signInFence?: number;

  /** Virtual: 'email' when password sign-in applies, plus every linked OAuth provider. */
  linkedProviders!: string[];

  // Timestamp fields (automatically managed by Mongoose with timestamps: true)
  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;

/**
 * The user as `toObject()` on a hydrated document returns it: every schema
 * field except `password`, which `select: false` omits, and the
 * `linkedProviders` virtual, which `toObject()` never includes, plus the
 * generated id. Authority reads hand the session's populated user this shape.
 */
export type LeanUser = Omit<User, 'password' | 'linkedProviders'> & {
  _id: Types.ObjectId;
};

export const UserSchema: MongooseSchema<User> =
  SchemaFactory.createForClass(User);

UserSchema.virtual('linkedProviders').get(function (
  this: UserDocument,
): string[] {
  const oauthProviders = (this.linkedAccounts ?? []).map(
    (account) => account.provider,
  );
  if (this.authProvider === EMAIL_PROVIDER) {
    return [EMAIL_PROVIDER, ...oauthProviders];
  }
  return oauthProviders;
});

// Indexes
UserSchema.index({ createdAt: -1 });
UserSchema.index({ isDeleted: 1 });
UserSchema.index({ role: 1 });
UserSchema.index(
  { 'linkedAccounts.provider': 1, 'linkedAccounts.providerId': 1 },
  { unique: true, sparse: true },
);

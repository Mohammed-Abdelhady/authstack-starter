import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { PASSKEY_NAME_MAX_LENGTH } from '../../../constants/passkeys.constants';

/**
 * One WebAuthn credential. The public key is all the server needs to check a
 * signature, so nothing here can be replayed if the collection leaks.
 */
@Schema({ timestamps: true })
export class Passkey {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user!: Types.ObjectId;

  /** Credential id as base64url, the value the authenticator signs under. */
  @Prop({ required: true, unique: true })
  credentialId!: string;

  /** COSE public key exactly as the authenticator produced it. */
  @Prop({ type: Buffer, required: true })
  publicKey!: Buffer;

  /**
   * Signature count reported by the authenticator. A count that fails to move
   * forward is how a cloned credential shows up, so it is checked on every
   * assertion. Authenticators that do not count leave it at zero.
   */
  @Prop({ type: Number, default: 0 })
  counter!: number;

  /** How the browser reached the authenticator: usb, nfc, internal, hybrid. */
  @Prop({ type: [String], default: [] })
  transports!: string[];

  /** 'singleDevice' or 'multiDevice', as reported at registration. */
  @Prop({ type: String })
  deviceType?: string;

  /** Whether the credential is synced to the provider's keychain. */
  @Prop({ type: Boolean, default: false })
  backedUp!: boolean;

  /** Label the user sees in the account settings. */
  @Prop({ required: true, trim: true, maxlength: PASSKEY_NAME_MAX_LENGTH })
  name!: string;

  /** Set by every accepted assertion. Null until the passkey is first used. */
  @Prop({ type: Date, default: null })
  lastUsedAt!: Date | null;

  // Timestamp fields (automatically managed by Mongoose with timestamps: true)
  createdAt!: Date;
  updatedAt!: Date;
}

export type PasskeyDocument = HydratedDocument<Passkey>;

export const PasskeySchema: MongooseSchema<Passkey> =
  SchemaFactory.createForClass(Passkey);

// Serves the per-user list and the count on the profile.
PasskeySchema.index({ user: 1, createdAt: -1 });

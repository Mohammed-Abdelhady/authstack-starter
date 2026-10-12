import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { MAGIC_LINK_RETENTION_SECONDS } from '../../../constants/magic-link.constants';

/**
 * One mailed sign-in link. Only the sha256 of the token is stored, so the
 * database never holds anything that can be mailed or replayed.
 */
@Schema({ timestamps: true })
export class PendingMagicLink {
  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  /** sha256 of the token, hex encoded. */
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  /**
   * When the link stops working. The TTL index removes the record an hour
   * after that.
   */
  @Prop({
    required: true,
    index: { expireAfterSeconds: MAGIC_LINK_RETENTION_SECONDS },
  })
  expiresAt!: Date;

  /** Set once, by the request that spends the link. */
  @Prop({ type: Date, default: null })
  consumedAt!: Date | null;

  @Prop()
  requestIp?: string;

  @Prop()
  userAgent?: string;

  @Prop()
  redirect?: string;

  /** sha256 of the nonce left with the browser that asked, hex encoded. */
  @Prop()
  requestNonceHash?: string;

  // Timestamp fields (automatically managed by Mongoose with timestamps: true)
  createdAt!: Date;
  updatedAt!: Date;
}

export type PendingMagicLinkDocument = HydratedDocument<PendingMagicLink>;

export const PendingMagicLinkSchema: MongooseSchema<PendingMagicLink> =
  SchemaFactory.createForClass(PendingMagicLink);

// One address's links, newest first.
PendingMagicLinkSchema.index({ email: 1, createdAt: -1 });

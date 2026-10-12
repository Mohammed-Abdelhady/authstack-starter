import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * One pending login challenge. The signed cookie carries the nonce; the count
 * of wrong codes lives here, because a client that holds its own cookie could
 * otherwise keep replaying the attempt it likes.
 */
@Schema({ timestamps: true })
export class TwoFactorChallenge {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  /** sha256 of the nonce inside the cookie, hex encoded. */
  @Prop({ required: true, unique: true })
  nonceHash!: string;

  @Prop({ type: Number, default: 0 })
  attempts!: number;

  /**
   * Set while one request is checking a code. A second request that arrives
   * with the same cookie cannot also issue a session from that challenge.
   */
  @Prop({ type: Date, default: null })
  claimedAt!: Date | null;

  /** The TTL index clears the record shortly after the challenge lapses. */
  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt!: Date;

  // Timestamp fields (automatically managed by Mongoose with timestamps: true)
  createdAt!: Date;
  updatedAt!: Date;
}

export type TwoFactorChallengeDocument = HydratedDocument<TwoFactorChallenge>;

export const TwoFactorChallengeSchema: MongooseSchema<TwoFactorChallenge> =
  SchemaFactory.createForClass(TwoFactorChallenge);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { MailCounterPurpose } from '../../../constants/registration';

/**
 * Per-address, per-purpose mailed-code counter. It lives apart from the code
 * record so deleting an expired record — by verification, resend or the TTL
 * index — cannot reset the count. The window is its own, derived from the
 * configured code lifetime and floored at fifteen minutes.
 */
@Schema({ timestamps: true })
export class MailCounter {
  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  purpose!: MailCounterPurpose;

  @Prop({ required: true, default: 1 })
  mailedCodes!: number;

  @Prop({ required: true })
  windowStartedAt!: Date;

  /**
   * The end of the window, or of what is remembered about wrong codes when
   * that is later. A deleted counter counts like a rolled-over one.
   */
  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt!: Date;

  /** Wrong codes since the last lock, the last right code or the last lapse. */
  @Prop({ default: 0 })
  failedGuesses?: number;

  /** Locks in a row. Each one doubles the next. */
  @Prop({ default: 0 })
  guessLockLevel?: number;

  @Prop()
  guessLockedUntil?: Date;

  /** Until when the three fields above mean anything. */
  @Prop()
  guessStateExpiresAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type MailCounterDocument = HydratedDocument<MailCounter>;

export const MailCounterSchema: MongooseSchema<MailCounter> =
  SchemaFactory.createForClass(MailCounter);

MailCounterSchema.index({ email: 1, purpose: 1 }, { unique: true });

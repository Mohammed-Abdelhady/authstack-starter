import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  PENDING_PURPOSE,
  PendingPurpose,
} from '../../../constants/registration';

/**
 * A code mailed to an address, with no credential on it. Nothing a caller
 * supplied before proving the address is stored here, so a later activation
 * cannot inherit it. One address may have a sign-up record and an email-change
 * record at once; the unique index keeps one of each purpose.
 */
@Schema({ timestamps: true })
export class PendingRegistration {
  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ type: String, required: true, enum: Object.values(PENDING_PURPOSE) })
  purpose!: PendingPurpose;

  /** Target account of an email-change record; absent for sign-up. */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  userId?: Types.ObjectId;

  /** The target's address generation when the change was issued. */
  @Prop()
  addressGeneration?: number;

  @Prop({ required: true, select: false })
  hashedCode!: string;

  @Prop({ required: true, default: 0 })
  attempts!: number;

  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type PendingRegistrationDocument = HydratedDocument<PendingRegistration>;

export const PendingRegistrationSchema: MongooseSchema<PendingRegistration> =
  SchemaFactory.createForClass(PendingRegistration);

PendingRegistrationSchema.index({ email: 1, purpose: 1 }, { unique: true });

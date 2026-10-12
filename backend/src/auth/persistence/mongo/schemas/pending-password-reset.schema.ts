import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class PendingPasswordReset {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true, select: false })
  hashedCode!: string;

  @Prop({ required: true, default: 0 })
  attempts!: number;

  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt!: Date;

  // Timestamp fields (automatically managed by Mongoose with timestamps: true)
  createdAt!: Date;
  updatedAt!: Date;
}

export type PendingPasswordResetDocument =
  HydratedDocument<PendingPasswordReset>;

export const PendingPasswordResetSchema: MongooseSchema<PendingPasswordReset> =
  SchemaFactory.createForClass(PendingPasswordReset);

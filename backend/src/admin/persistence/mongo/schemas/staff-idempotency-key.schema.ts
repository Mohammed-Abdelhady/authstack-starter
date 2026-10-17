import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import type { StaffCreateResult } from '../../../types/staff-idempotency';

@Schema({ collection: 'staffidempotencykeys', versionKey: false })
export class StaffIdempotencyKey {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true })
  requestHash!: string;

  @Prop({ type: String, default: null })
  resourceId!: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  result!: StaffCreateResult | null;

  @Prop({ type: String, default: null })
  secretHash!: string | null;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type StaffIdempotencyKeyDocument = HydratedDocument<StaffIdempotencyKey>;
export const StaffIdempotencyKeySchema =
  SchemaFactory.createForClass(StaffIdempotencyKey);
StaffIdempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

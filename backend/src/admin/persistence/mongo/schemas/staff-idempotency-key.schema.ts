import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ collection: 'staffidempotencykeys', versionKey: false })
export class StaffIdempotencyKey {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true })
  requestHash!: string;

  @Prop({ type: String, default: null })
  resourceId!: string | null;

  @Prop({ type: Date, required: true })
  createdAt!: Date;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export type StaffIdempotencyKeyDocument = HydratedDocument<StaffIdempotencyKey>;
export const StaffIdempotencyKeySchema =
  SchemaFactory.createForClass(StaffIdempotencyKey);
StaffIdempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

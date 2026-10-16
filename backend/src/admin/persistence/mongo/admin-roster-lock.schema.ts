import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ collection: 'adminrosterlocks', versionKey: false })
export class AdminRosterLock {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Number, default: 0 })
  lockVersion!: number;
}

export type AdminRosterLockDocument = HydratedDocument<AdminRosterLock>;
export const AdminRosterLockSchema =
  SchemaFactory.createForClass(AdminRosterLock);

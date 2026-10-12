import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { DEFAULT_API_AUDIENCE } from '../../../constants/client-ids';

@Schema({ timestamps: true })
export class UserApplicationGrant {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  clientId!: string;

  @Prop({ type: [String], default: [DEFAULT_API_AUDIENCE] })
  allowedScopes!: string[];

  @Prop({ default: true })
  allowed!: boolean;

  @Prop({ type: Number, default: 0 })
  sessionVersion!: number;

  @Prop({ type: Number, default: 0 })
  issuanceFence!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserApplicationGrantDocument =
  HydratedDocument<UserApplicationGrant>;

export const UserApplicationGrantSchema: MongooseSchema<UserApplicationGrant> =
  SchemaFactory.createForClass(UserApplicationGrant);

UserApplicationGrantSchema.index(
  { userId: 1, clientId: 1 },
  { unique: true, name: 'grant_user_client_unique' },
);

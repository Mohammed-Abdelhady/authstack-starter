import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true })
export class StepUpChallenge {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Session', required: true })
  sessionId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  clientId!: string;

  @Prop({ required: true })
  action!: string;

  @Prop()
  targetId?: string;

  @Prop({ required: true })
  nonceDigest!: string;

  @Prop({ required: true })
  method!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ default: false })
  consumed!: boolean;

  @Prop({ required: true })
  authEpoch!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type StepUpChallengeDocument = HydratedDocument<StepUpChallenge>;

export const StepUpChallengeSchema: MongooseSchema<StepUpChallenge> =
  SchemaFactory.createForClass(StepUpChallenge);

StepUpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
StepUpChallengeSchema.index({ sessionId: 1, consumed: 1 });

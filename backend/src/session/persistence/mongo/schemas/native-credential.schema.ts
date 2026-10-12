import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  CREDENTIAL_PURPOSE,
  CredentialPurpose,
} from '../../../constants/credential-purpose';

@Schema({ timestamps: true })
export class NativeCredential {
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({
    type: String,
    enum: [CREDENTIAL_PURPOSE.NATIVE_ACCESS, CREDENTIAL_PURPOSE.NATIVE_REFRESH],
    required: true,
  })
  purpose!: CredentialPurpose;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Session', required: true })
  sessionId!: Types.ObjectId;

  @Prop({ required: true })
  clientId!: string;

  @Prop({ type: Number, required: true })
  generation!: number;

  @Prop({ required: true })
  familyId!: string;

  @Prop({ required: true })
  issuedAt!: Date;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ required: true, default: false })
  spent!: boolean;

  @Prop()
  consumedAt?: Date;

  @Prop()
  revokedAt?: Date;

  @Prop()
  proofKeyThumbprint?: string;

  @Prop()
  firstUsedAt?: Date;

  @Prop()
  successorAccessHash?: string;

  @Prop()
  successorRefreshHash?: string;

  @Prop()
  retryClaimUntil?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type NativeCredentialDocument = HydratedDocument<NativeCredential>;

export const NativeCredentialSchema: MongooseSchema<NativeCredential> =
  SchemaFactory.createForClass(NativeCredential);

NativeCredentialSchema.index({ sessionId: 1, familyId: 1 });
NativeCredentialSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

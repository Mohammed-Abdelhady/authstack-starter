import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class NativeDpopProofId {
  @Prop({ required: true })
  proofIdHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;
}

export type NativeDpopProofIdDocument = HydratedDocument<NativeDpopProofId>;

export const NativeDpopProofIdSchema: MongooseSchema<NativeDpopProofId> =
  SchemaFactory.createForClass(NativeDpopProofId);

NativeDpopProofIdSchema.index(
  { proofIdHash: 1 },
  { unique: true, name: 'native_dpop_proof_id_unique' },
);
NativeDpopProofIdSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

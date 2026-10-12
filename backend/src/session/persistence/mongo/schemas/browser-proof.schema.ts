import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({ timestamps: true })
export class BrowserProof {
  @Prop({ required: true })
  proofIdHash!: string;

  @Prop({ required: true })
  tokenHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ required: true, default: false })
  spent!: boolean;
}

export type BrowserProofDocument = HydratedDocument<BrowserProof>;

export const BrowserProofSchema: MongooseSchema<BrowserProof> =
  SchemaFactory.createForClass(BrowserProof);

BrowserProofSchema.index(
  { proofIdHash: 1 },
  { unique: true, name: 'browser_proof_id_unique' },
);
BrowserProofSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

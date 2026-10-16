import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { FRESH_PROOF_KIND } from '../../../contracts/constants/fresh-proof';
import { ProofKind } from '../../types/session-proof';

@Schema({ collection: 'sessionproofs', versionKey: false })
export class SessionProof {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, required: true })
  userId!: string;

  @Prop({ type: String, required: true })
  clientId!: string;

  @Prop({ type: String, enum: Object.values(FRESH_PROOF_KIND), default: null })
  challengeKind!: ProofKind | null;

  @Prop({ type: String, default: null })
  challengeHash!: string | null;

  @Prop({ type: Date, default: null })
  challengeExpiresAt!: Date | null;

  @Prop({ type: Number, default: 0 })
  challengeWrongGuesses!: number;

  @Prop({ type: String, enum: Object.values(FRESH_PROOF_KIND), default: null })
  proofKind!: ProofKind | null;

  @Prop({ type: String, default: null })
  proofRpId!: string | null;

  @Prop({ type: Boolean, default: false })
  proofUserVerified!: boolean;

  @Prop({ type: Date, default: null })
  provedAt!: Date | null;

  @Prop({ type: Date, required: true })
  purgeAfter!: Date;

  @Prop({ type: Number, default: 0 })
  lockVersion!: number;
}

export type SessionProofDocument = HydratedDocument<SessionProof>;
export const SessionProofSchema = SchemaFactory.createForClass(SessionProof);
SessionProofSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });

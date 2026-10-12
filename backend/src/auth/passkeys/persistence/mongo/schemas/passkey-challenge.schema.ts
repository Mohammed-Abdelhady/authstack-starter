import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { PasskeyChallengePurpose } from '../../../constants/passkeys.constants';

/**
 * One WebAuthn challenge the server handed out. Clearing the signed cookie
 * does not spend a copy of that cookie, so the hashed challenge lives here
 * until the matching assertion consumes it.
 */
@Schema({ timestamps: true })
export class PasskeyChallenge {
  /** sha256 of the WebAuthn challenge, hex encoded. */
  @Prop({ required: true, unique: true })
  challengeHash!: string;

  @Prop({ type: String, required: true })
  purpose!: PasskeyChallengePurpose;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  user?: Types.ObjectId;

  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt!: Date;
}

export type PasskeyChallengeDocument = HydratedDocument<PasskeyChallenge>;

export const PasskeyChallengeSchema: MongooseSchema<PasskeyChallenge> =
  SchemaFactory.createForClass(PasskeyChallenge);

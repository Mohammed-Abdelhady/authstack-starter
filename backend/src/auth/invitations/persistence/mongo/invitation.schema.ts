import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  ROLE_AUDIENCE,
  RoleAudience,
} from '../../../../host/types/host-role.type';
import { INVITATION_PURPOSE } from '../../constants/invitations';
import { InvitationPurpose } from '../../types/invitation';

@Schema({ collection: 'invitations', versionKey: false })
export class Invitation {
  @Prop({ type: String, required: true })
  _id!: string;
  @Prop({
    type: String,
    required: true,
    enum: Object.values(INVITATION_PURPOSE),
  })
  purpose!: InvitationPurpose;
  @Prop({ type: String, required: true, lowercase: true, trim: true })
  email!: string;
  @Prop({ type: String })
  name?: string;
  @Prop({ type: String })
  roleId?: string;
  @Prop({ type: String })
  roleSlug?: string;
  @Prop({ type: String, enum: Object.values(ROLE_AUDIENCE) })
  audience?: RoleAudience;
  @Prop({ type: String, required: true })
  clientId!: string;
  @Prop({ type: String })
  invitedBy?: string;
  @Prop({ type: String })
  userId?: string;
  @Prop({ type: Number })
  addressGeneration?: number;
  @Prop({ type: String, required: true })
  locale!: string;
  @Prop({ type: String, required: true })
  tokenHash!: string;
  @Prop({ type: Date, required: true })
  expiresAt!: Date;
  @Prop({ type: Date })
  acceptedAt?: Date;
  @Prop({ type: Date })
  revokedAt?: Date;
  @Prop({ type: Date, required: true })
  purgeAfter!: Date;
  @Prop({ type: Date, required: true })
  createdAt!: Date;
  @Prop({ type: Date, required: true })
  updatedAt!: Date;
  @Prop({ type: Number, default: 0 })
  lockVersion!: number;
}
export type InvitationDocument = HydratedDocument<Invitation>;
export const InvitationSchema = SchemaFactory.createForClass(Invitation);
InvitationSchema.index({ tokenHash: 1 }, { unique: true });
InvitationSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });
InvitationSchema.index({ createdAt: -1, _id: -1 });
InvitationSchema.index({ userId: 1 });

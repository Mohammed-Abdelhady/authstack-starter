import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { SECURITY_EVENT_PURGE_MS } from '../../../constants/session-policy';
import { RoleDeletionSweep } from '../../../types/role-deletion-sweep';
import { RoleAssignmentEvent } from '../../../types/role-assignment-event';

const RoleAssignmentEventSchema = new MongooseSchema<RoleAssignmentEvent>(
  { assignedRoleId: String, previousRoleId: String, sessionVersion: Number },
  { _id: false },
);

const RoleDeletionSweepSchema = new MongooseSchema<RoleDeletionSweep>(
  {
    roleId: String,
    previousSlug: String,
    actorId: String,
    pending: Boolean,
    sweepId: String,
  },
  { _id: false },
);

@Schema({ timestamps: true })
export class SecurityEvent {
  @Prop({ required: true, unique: true })
  eventId!: string;

  @Prop()
  actorId?: string;

  @Prop()
  targetUserId?: string;

  @Prop()
  clientId?: string;

  @Prop()
  sessionId?: string;

  @Prop({ required: true })
  action!: string;

  @Prop()
  reasonCode?: string;

  @Prop()
  requestId?: string;

  @Prop({ type: RoleAssignmentEventSchema })
  roleAssignment?: RoleAssignmentEvent;

  @Prop({ type: RoleDeletionSweepSchema })
  roleDeletionSweep?: RoleDeletionSweep;

  @Prop({ required: true })
  outcome!: string;

  @Prop({ required: true })
  occurredAt!: Date;

  @Prop({
    required: true,
    default: () => new Date(Date.now() + SECURITY_EVENT_PURGE_MS),
  })
  purgeAfter!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type SecurityEventDocument = HydratedDocument<SecurityEvent>;

export const SecurityEventSchema: MongooseSchema<SecurityEvent> =
  SchemaFactory.createForClass(SecurityEvent);

SecurityEventSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });
SecurityEventSchema.index({ targetUserId: 1, occurredAt: -1 });

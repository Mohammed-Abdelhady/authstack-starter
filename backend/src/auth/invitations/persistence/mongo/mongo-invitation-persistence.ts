import {
  User,
  UserSchema,
} from '../../../../user/persistence/mongo/schemas/user.schema';
import type { Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvitationStore } from '../../stores/invitation.store';
import { Invitation, InvitationSchema } from './invitation.schema';
import { MongoInvitationStore } from './mongo-invitation.store';

export const MONGO_INVITATION_MODELS = MongooseModule.forFeature([
  { name: Invitation.name, schema: InvitationSchema },
  { name: User.name, schema: UserSchema },
]);
export const MONGO_INVITATION_PROVIDERS: Provider[] = [
  { provide: InvitationStore, useClass: MongoInvitationStore },
];

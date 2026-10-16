import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import {
  INVITATION_PERSISTENCE_IMPORTS,
  INVITATION_PERSISTENCE_PROVIDERS,
} from './persistence/invitation-persistence';

/** Invitations and enrolment links: their store, their tokens and acceptance. */
@Module({
  imports: [CommonModule, ...INVITATION_PERSISTENCE_IMPORTS],
  providers: [...INVITATION_PERSISTENCE_PROVIDERS],
  exports: [],
})
export class InvitationsModule {}

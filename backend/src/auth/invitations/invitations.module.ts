import { Module } from '@nestjs/common';
import {
  ADMIN_PERSISTENCE_IMPORTS,
  ADMIN_PERSISTENCE_PROVIDERS,
} from '../../admin/persistence/admin-persistence';
import { CommonModule } from '../../common/common.module';
import { MailModule } from '../../mail/mail.module';
import { RoleModule } from '../../role/role.module';
import { SessionModule } from '../../session/session.module';
import { AuthModule } from '../auth.module';
import { InvitationCeremonies } from './invitation-ceremonies';
import { InvitationsController } from './invitations.controller';
import {
  INVITATION_PERSISTENCE_IMPORTS,
  INVITATION_PERSISTENCE_PROVIDERS,
} from './persistence/invitation-persistence';
import { InvitationAcceptService } from './services/invitation-accept.service';
import { InvitationAccountCreator } from './services/invitation-account-creator';
import { InvitationIssuer } from './services/invitation-issuer';
import { InvitationMailer } from './services/invitation-mailer';
import { InvitationStore } from './stores/invitation.store';

@Module({
  imports: [
    CommonModule,
    SessionModule,
    AuthModule,
    RoleModule,
    MailModule,
    ...ADMIN_PERSISTENCE_IMPORTS,
    ...INVITATION_PERSISTENCE_IMPORTS,
  ],
  controllers: [InvitationsController],
  providers: [
    ...ADMIN_PERSISTENCE_PROVIDERS,
    ...INVITATION_PERSISTENCE_PROVIDERS,
    InvitationCeremonies,
    InvitationAccountCreator,
    InvitationIssuer,
    InvitationMailer,
    InvitationAcceptService,
  ],
  exports: [
    InvitationStore,
    InvitationIssuer,
    InvitationMailer,
    InvitationAcceptService,
  ],
})
export class InvitationsModule {}

import { APP_CONFIGURATION } from '../config/app-configuration';
import { Module } from '@nestjs/common';
import {
  ADMIN_PERSISTENCE_IMPORTS,
  ADMIN_PERSISTENCE_PROVIDERS,
} from '../admin/persistence/admin-persistence';
import { AdminAudienceScopes } from '../admin/services/users/admin-audience-scopes';
import { AdminEmailChangeService } from '../admin/services/users/admin-email-change.service';
import { AdminAccountStore } from '../admin/stores/admin-account.store';
import { AdminRosterStore } from '../admin/stores/admin-roster.store';
import { AuthModule } from '../auth/auth.module';
import { InvitationsModule } from '../auth/invitations/invitations.module';
import { CommonModule } from '../common/common.module';
import { STORAGE_CONNECTION_IMPORTS } from '../common/persistence/common-persistence';
import { RoleModule } from '../role/role.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [
    APP_CONFIGURATION,
    ...STORAGE_CONNECTION_IMPORTS,
    CommonModule,
    SessionModule,
    AuthModule,
    InvitationsModule,
    RoleModule,
    ...ADMIN_PERSISTENCE_IMPORTS,
  ],
  providers: [
    ...ADMIN_PERSISTENCE_PROVIDERS,
    AdminAudienceScopes,
    AdminEmailChangeService,
  ],
  exports: [
    CommonModule,
    SessionModule,
    AuthModule,
    InvitationsModule,
    AdminAccountStore,
    AdminRosterStore,
    AdminEmailChangeService,
  ],
})
export class AdminCommandModule {}

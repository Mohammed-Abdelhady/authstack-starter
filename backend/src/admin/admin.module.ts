import { AdminUserReadController } from './admin-user-read.controller';
import { AdminAudienceScopes } from './services/users/admin-audience-scopes';
import { Module, forwardRef } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminPermissionsController } from './admin-permissions.controller';
import { AdminSessionsController } from './sessions/admin-sessions.controller';
import { AdminSessionsService } from './sessions/admin-sessions.service';
import { AdminSessionAccessService } from './sessions/admin-session-access.service';
import { AdminActivityController } from './activity/admin-activity.controller';
import { AdminActivityService } from './activity/admin-activity.service';
import { AdminUsersService } from './services/users/admin-users.service';
import { AdminUserCreateService } from './services/users/admin-user-create.service';
import { AdminUserQueriesService } from './services/users/admin-user-queries.service';
import { AdminUserAccessService } from './services/users/admin-user-access.service';
import { AdminEmailChangeService } from './services/users/admin-email-change.service';
import { AdminPermissionsService } from './services/roles/admin-permissions.service';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { SessionModule } from '../session/session.module';
import { RoleModule } from '../role/role.module';
import { UserModule } from '../user/user.module';
import { CommonModule } from '../common/common.module';
import { AuthContractsModule } from '../auth/contracts/auth-contracts.module';
import { StaffMutationsModule } from './services/staff-mutations/staff-mutations.module';
import { LastAdminGuard } from './services/staff-mutations/last-admin-guard';
import { InvitationsModule } from '../auth/invitations/invitations.module'; // feature:invitations
import {
  ADMIN_PERSISTENCE_IMPORTS,
  ADMIN_PERSISTENCE_PROVIDERS,
} from './persistence/admin-persistence';

/**
 * Admin module for user management operations.
 * Provides endpoints for listing, viewing, updating and deleting users, plus
 * direct permission grants.
 */
@Module({
  imports: [
    CommonModule,
    ...ADMIN_PERSISTENCE_IMPORTS,
    AuthModule,
    SessionModule,
    MailModule,
    RoleModule,
    AuthContractsModule,
    StaffMutationsModule,
    InvitationsModule, // feature:invitations
    forwardRef(() => UserModule),
  ],
  controllers: [
    AdminUsersController,
    AdminUserReadController,
    AdminPermissionsController,
    AdminSessionsController,
    AdminActivityController,
  ],
  providers: [
    AdminUsersService,
    AdminUserCreateService,
    AdminUserQueriesService,
    AdminUserAccessService,
    AdminAudienceScopes,
    AdminEmailChangeService,
    AdminPermissionsService,
    AdminSessionsService,
    AdminSessionAccessService,
    AdminActivityService,
    LastAdminGuard,
    ...ADMIN_PERSISTENCE_PROVIDERS,
  ],
  exports: [AdminUsersService],
})
export class AdminModule {}

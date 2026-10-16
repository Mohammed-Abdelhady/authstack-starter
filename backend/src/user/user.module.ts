import { CommonModule } from '../common/common.module';
import { MailModule } from '../mail/mail.module';
import { SecurityNoticeService } from './services/security-notice.service';
import { Module, forwardRef } from '@nestjs/common';
import { UserProfileController } from './user-profile.controller';
import { UserSessionsController } from './user-sessions.controller';
import { UserProvidersController } from './user-providers.controller'; // feature:oauth-core
import { UserProfileService } from './services/user-profile.service';
import { UserSessionsService } from './services/user-sessions.service';
import { UserPermissionsService } from './services/user-permissions.service';
import { SignInMethodRule } from './services/sign-in-method.rule';
import { AccountLinkingService } from './services/account-linking.service'; // feature:oauth-core
import { ProfileSyncService } from './services/profile-sync.service'; // feature:oauth-core
import { AuthModule } from '../auth/auth.module';
import { SessionModule } from '../session/session.module';
import {
  USER_PERSISTENCE_IMPORTS,
  USER_PERSISTENCE_PROVIDERS,
} from './persistence/user-persistence';
import { AccountSessions } from './stores/account-sessions';
import { AccountProfileStore } from './stores/account-profile.store';
import { ErasureModule } from './erasure/erasure.module';
// feature:oauth-core:start
import { ProviderTokensModule } from '../auth/oauth/provider-tokens/provider-tokens.module';
// feature:oauth-core:end

@Module({
  imports: [
    CommonModule,
    MailModule,
    ...USER_PERSISTENCE_IMPORTS,
    forwardRef(() => AuthModule),
    SessionModule,
    ErasureModule,
    ProviderTokensModule, // feature:oauth-core
  ],
  controllers: [
    UserProfileController,
    UserSessionsController,
    UserProvidersController, // feature:oauth-core
  ],
  providers: [
    UserProfileService,
    SecurityNoticeService,
    UserSessionsService,
    UserPermissionsService,
    SignInMethodRule,
    AccountLinkingService, // feature:oauth-core
    ProfileSyncService, // feature:oauth-core
    ...USER_PERSISTENCE_PROVIDERS,
  ],
  exports: [
    ...USER_PERSISTENCE_IMPORTS,
    AccountSessions,
    AccountProfileStore,
    UserProfileService,
    SecurityNoticeService,
    UserSessionsService,
    UserPermissionsService,
    SignInMethodRule,
    AccountLinkingService, // feature:oauth-core
    ProfileSyncService, // feature:oauth-core
    // The OAuth module imports this one, and its Apple strategy keeps tokens.
    ProviderTokensModule, // feature:oauth-core
  ],
})
export class UserModule {}

import { Module, forwardRef } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RegistrationService } from './services/registration/registration.service';
import { AuthController } from './auth.controller';
import { IdentityController } from './identity.controller';
import { Sessions } from './services/sessions/sessions';
import { SessionCookieService } from './services/sessions/session-cookie.service';
import { SignInCompletion } from './services/sessions/sign-in-completion';
import { TotpSecretCryptoService } from './two-factor/services/totp-secret-crypto.service'; // feature:totp
import { TwoFactorChallengeService } from './two-factor/services/two-factor-challenge.service'; // feature:totp
import { TwoFactorVerificationService } from './two-factor/services/two-factor-verification.service'; // feature:totp
import { SecondFactorStore } from './two-factor/stores/second-factor.store'; // feature:totp
import { VerificationCodeService } from './services/codes/verification-code.service';
import { MailCounterService } from './services/mail/mail-counter.service';
import { EmailChangeConfirmationService } from './services/registration/email-change-confirmation.service';
import { PasswordResetCodeService } from './services/codes/password-reset-code.service';
import { AuthMailService } from './services/mail/auth-mail.service';
import { AuthFeaturesService } from './services/features/auth-features.service';
import { FeatureEnabledGuard } from './guards/feature-enabled.guard';
import { CommonModule } from '../common/common.module';
import { MailModule } from '../mail/mail.module';
import { UserModule } from '../user/user.module';
import { SessionModule } from '../session/session.module';
import { BrowserProofGuard } from './guards/browser-proof.guard';
import { AuthGuard } from './guards/auth.guard';
import {
  AUTH_PERSISTENCE_EXPORTS,
  AUTH_PERSISTENCE_IMPORTS,
  AUTH_PERSISTENCE_PROVIDERS,
} from './persistence/auth-persistence';

@Module({
  imports: [
    ConfigModule,
    ...AUTH_PERSISTENCE_IMPORTS,
    CommonModule,
    MailModule,
    forwardRef(() => UserModule),
    SessionModule,
  ],
  controllers: [AuthController, IdentityController],
  providers: [
    AuthService,
    RegistrationService,
    Sessions,
    SessionCookieService,
    VerificationCodeService,
    MailCounterService,
    EmailChangeConfirmationService,
    PasswordResetCodeService,
    AuthMailService,
    AuthFeaturesService,
    ...AUTH_PERSISTENCE_PROVIDERS,
    // feature:totp:start
    // The second factor hooks into every sign-in path, so the pieces those
    // paths need are declared here rather than in TwoFactorModule.
    TotpSecretCryptoService,
    TwoFactorChallengeService,
    TwoFactorVerificationService,
    // feature:totp:end
    SignInCompletion,
    FeatureEnabledGuard,
    AuthGuard,
    // Registered here, not in AppModule: AuthGuard reads sessions and
    // accounts, which only resolve inside this module's context.
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: BrowserProofGuard,
    },
  ],
  exports: [
    ...AUTH_PERSISTENCE_EXPORTS,
    AuthService,
    Sessions,
    SessionCookieService,
    VerificationCodeService,
    AuthMailService,
    AuthFeaturesService,
    // feature:totp:start
    TotpSecretCryptoService,
    TwoFactorChallengeService,
    TwoFactorVerificationService,
    SecondFactorStore,
    // feature:totp:end
    SignInCompletion,
    FeatureEnabledGuard,
    AuthGuard,
  ],
})
export class AuthModule {}

/**
 * Decorators are exported directly from their source files:
 * - @Public() from './decorators/public.decorator'
 * - @CurrentUser() from './decorators/current-user.decorator'
 */

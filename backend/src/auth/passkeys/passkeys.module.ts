import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  PASSKEYS_PERSISTENCE_IMPORTS,
  PASSKEYS_PERSISTENCE_PROVIDERS,
} from './persistence/passkeys-persistence';
import { AuthModule } from '../auth.module';
import { SessionModule } from '../../session/session.module';
import { PasskeysController } from './passkeys.controller';
import { PasskeyLoginController } from './passkey-login.controller';
import { PasskeyAssertionService } from './services/passkey-assertion.service';
import { PasskeyChallengeService } from './services/passkey-challenge.service';
import { PasskeyConfigService } from './services/passkey-config.service';
import { PasskeyLoginService } from './services/passkey-login.service';
import { PasskeyManagementService } from './services/passkey-management.service';
import { PasskeyRegistrationReauth } from './services/passkey-registration-reauth.service';
import { PasskeyRegistrationService } from './services/passkey-registration.service';
import { PasskeySecondFactorVerifier } from './services/passkey-second-factor.verifier';
import { WebAuthnAdapter } from './services/webauthn.adapter';
import { PasskeyStore } from './stores/passkey.store';
import { UserModule } from '../../user/user.module';
import { CommonModule } from '../../common/common.module';

/**
 * WebAuthn sign-in and passkey management. Sessions and the feature switch
 * come from AuthModule, so this module can be dropped without touching the
 * rest of auth.
 *
 * PasskeySecondFactorVerifier is exported for TwoFactorModule, which accepts a
 * passkey as an answer to a two-factor challenge. Nothing here imports
 * TwoFactorModule, which is what keeps that one-way.
 */
@Module({
  imports: [
    ConfigModule,
    // The password check a passkey is added behind.
    CommonModule,
    ...PASSKEYS_PERSISTENCE_IMPORTS,
    AuthModule,
    // The unit of work a passkey removal runs in.
    SessionModule,
    // The rule that keeps a way to sign in on the account.
    UserModule,
  ],
  controllers: [PasskeysController, PasskeyLoginController],
  providers: [
    WebAuthnAdapter,
    PasskeyConfigService,
    PasskeyChallengeService,
    PasskeyRegistrationReauth,
    PasskeyRegistrationService,
    PasskeyAssertionService,
    PasskeyLoginService,
    PasskeyManagementService,
    PasskeySecondFactorVerifier,
    ...PASSKEYS_PERSISTENCE_PROVIDERS,
  ],
  exports: [
    WebAuthnAdapter,
    PasskeyStore,
    PasskeyAssertionService,
    PasskeyManagementService,
    PasskeySecondFactorVerifier,
  ],
})
export class PasskeysModule {}

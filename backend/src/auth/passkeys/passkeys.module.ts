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
import { PasskeyLoginService } from './services/passkey-login.service';
import { PasskeyManagementService } from './services/passkey-management.service';
import { PasskeyRegistrationReauth } from './services/passkey-registration-reauth.service';
import { PasskeyRegistrationService } from './services/passkey-registration.service';
import { PasskeySecondFactorVerifier } from './services/passkey-second-factor.verifier';
import { PasskeyRecorder } from './services/passkey-recorder.service';
import {
  EnrolmentPromotion,
  NoEnrolmentPromotion,
} from './services/enrolment-promotion';
import { NativePasskeysController } from './native/native-passkeys.controller';
import { NativePasskeyRegistrationService } from './native/native-passkey-registration.service';
import { NativeRelyingParties } from './native/native-relying-parties';
import { WebAuthnAdapter } from './services/webauthn.adapter';
import { LegacyPasskeyFactsModule } from './passkey-facts.module';
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
    LegacyPasskeyFactsModule,
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
  controllers: [
    PasskeysController,
    PasskeyLoginController,
    NativePasskeysController,
  ],
  providers: [
    WebAuthnAdapter,
    PasskeyChallengeService,
    PasskeyRegistrationReauth,
    PasskeyRegistrationService,
    PasskeyAssertionService,
    PasskeyLoginService,
    PasskeyManagementService,
    PasskeySecondFactorVerifier,
    PasskeyRecorder,
    // Where an enrolment promotion joins a registration's transaction. Moves
    // to AuthContractsModule with contracts/enrolment-promotion.ts.
    { provide: EnrolmentPromotion, useClass: NoEnrolmentPromotion },
    NativeRelyingParties,
    NativePasskeyRegistrationService,
    ...PASSKEYS_PERSISTENCE_PROVIDERS,
  ],
  exports: [
    WebAuthnAdapter,
    // The one resolver of a native application's relying party.
    NativeRelyingParties,
    LegacyPasskeyFactsModule,
    PasskeyAssertionService,
    PasskeyManagementService,
    PasskeySecondFactorVerifier,
  ],
})
export class PasskeysModule {}

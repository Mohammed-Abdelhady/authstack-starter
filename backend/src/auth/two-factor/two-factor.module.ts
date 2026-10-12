import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth.module';
import { PasskeysModule } from '../passkeys/passkeys.module'; // feature:passkeys
import { PasskeySecondFactorVerifier } from '../passkeys/services/passkey-second-factor.verifier'; // feature:passkeys
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorLoginService } from './two-factor-login.service';
import { TwoFactorReauthService } from './services/two-factor-reauth.service';
import {
  SECOND_FACTOR_VERIFIERS,
  SecondFactorVerifier,
} from './services/second-factor-verifiers';
import { TWO_FACTOR_PERSISTENCE_PROVIDERS } from './persistence/two-factor-persistence';
import { CommonModule } from '../../common/common.module';
import { UserModule } from '../../user/user.module';
import { SessionModule } from '../../session/session.module';

/**
 * Routes for the TOTP second factor.
 *
 * The pieces the sign-in paths need, the challenge service, the secret crypto
 * and the stores under them, live in AuthModule instead: password, magic link and OAuth all have
 * to reach them, and importing this module from there would close a cycle.
 *
 * Other ways of answering a challenge are registered under
 * SECOND_FACTOR_VERIFIERS, one line per feature that offers one. The
 * dependency runs one way: a passkey knows nothing about the second factor.
 */
@Module({
  imports: [
    ConfigModule,
    CommonModule,
    UserModule,
    SessionModule,
    AuthModule,
    PasskeysModule, // feature:passkeys
  ],
  controllers: [TwoFactorController],
  providers: [
    TwoFactorService,
    TwoFactorLoginService,
    TwoFactorReauthService,
    ...TWO_FACTOR_PERSISTENCE_PROVIDERS,
    {
      provide: SECOND_FACTOR_VERIFIERS,
      useFactory: (
        passkeys: PasskeySecondFactorVerifier, // feature:passkeys
      ): SecondFactorVerifier[] => [
        passkeys, // feature:passkeys
      ],
      inject: [
        PasskeySecondFactorVerifier, // feature:passkeys
      ],
    },
  ],
  exports: [TwoFactorService],
})
export class TwoFactorModule {}

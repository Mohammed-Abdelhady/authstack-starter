import { Module } from '@nestjs/common';
import { AuthModule } from '../auth.module';
import { UserModule } from '../../user/user.module';
import { SessionModule } from '../../session/session.module';
import { NativeOAuthModule } from '../../session/native/oauth/native-oauth.module';
import { NativeAuthController } from './native-auth.controller';
import { NATIVE_AUTH_PERSISTENCE_PROVIDERS } from './persistence/native-auth-persistence';
import { NativeAttemptStore } from './stores/native-attempt.store';
import { NativeAttemptService } from './services/native-attempt.service';
import { NativeAttemptViewService } from './services/native-attempt-view.service';
import { NativeConsentService } from './services/native-consent.service';
import { NativeMethodsService } from './services/native-methods.service';
import { PasskeysModule } from '../passkeys/passkeys.module'; // feature:passkeys

@Module({
  imports: [
    AuthModule,
    UserModule,
    SessionModule,
    NativeOAuthModule,
    PasskeysModule, // feature:passkeys
  ],
  controllers: [NativeAuthController],
  providers: [
    ...NATIVE_AUTH_PERSISTENCE_PROVIDERS,
    NativeMethodsService,
    NativeAttemptViewService,
    NativeAttemptService,
    NativeConsentService,
  ],
  exports: [
    NativeAttemptStore,
    NativeMethodsService,
    NativeAttemptService,
    NativeConsentService,
  ],
})
export class NativeAuthModule {}

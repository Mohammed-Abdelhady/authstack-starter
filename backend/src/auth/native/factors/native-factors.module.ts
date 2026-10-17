import { ErasureModule } from '../../../user/erasure/erasure.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth.module';
import { PasskeysModule } from '../../passkeys/passkeys.module'; // feature:passkeys
import { CommonModule } from '../../../common/common.module';
import { UserModule } from '../../../user/user.module';
import { SessionModule } from '../../../session/session.module';
import { NativeAuthModule } from '../native-auth.module';
import { NativeFactorsController } from './native-factors.controller';
import { NativePasswordService } from './native-password.service'; // feature:email-password
import { NativeSecondFactorService } from './native-second-factor.service'; // feature:totp
import { NativePasskeyService } from './native-passkey.service'; // feature:passkeys

@Module({
  imports: [
    ErasureModule,
    AuthModule,
    PasskeysModule, // feature:passkeys
    CommonModule,
    UserModule,
    SessionModule,
    NativeAuthModule,
  ],
  controllers: [NativeFactorsController],
  providers: [
    NativePasswordService, // feature:email-password
    NativeSecondFactorService, // feature:totp
    NativePasskeyService, // feature:passkeys
  ],
  exports: [
    NativePasswordService, // feature:email-password
    NativeSecondFactorService, // feature:totp
    NativePasskeyService, // feature:passkeys
  ],
})
export class NativeFactorsModule {}

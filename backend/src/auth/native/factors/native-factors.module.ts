import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth.module';
import { PasskeysModule } from '../../passkeys/passkeys.module'; // feature:passkeys
import { CommonModule } from '../../../common/common.module';
import { UserModule } from '../../../user/user.module';
import { NativeAuthModule } from '../native-auth.module';
import { NativeFactorsController } from './native-factors.controller';
import { NativePasswordService } from './native-password.service';
import { NativeSecondFactorService } from './native-second-factor.service';
import { NativePasskeyService } from './native-passkey.service';

@Module({
  imports: [
    AuthModule,
    PasskeysModule, // feature:passkeys
    CommonModule,
    UserModule,
    NativeAuthModule,
  ],
  controllers: [NativeFactorsController],
  providers: [
    NativePasswordService,
    NativeSecondFactorService,
    NativePasskeyService,
  ],
  exports: [
    NativePasswordService,
    NativeSecondFactorService,
    NativePasskeyService,
  ],
})
export class NativeFactorsModule {}

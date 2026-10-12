import { Module } from '@nestjs/common';
import { CommonModule } from '../../../common/common.module';
import { SessionModule } from '../../../session/session.module';
import { UserModule } from '../../../user/user.module';
import { MailModule } from '../../../mail/mail.module'; // feature:magic-link,email-password
import { AuthModule } from '../../auth.module';
import { MagicLinkModule } from '../../magic-link/magic-link.module'; // feature:magic-link
import { NativeAuthModule } from '../native-auth.module';
import { NativeEmailLinkController } from './native-email-link.controller'; // feature:magic-link
import { NativeRegistrationController } from './native-registration.controller'; // feature:email-password
import { NativeRecoveryController } from './native-recovery.controller'; // feature:email-password
import { NativeEmailLinkService } from './native-email-link.service'; // feature:magic-link
import { NativeEmailLinkMailService } from './native-email-link-mail.service'; // feature:magic-link
import { NativeRegistrationService } from './native-registration.service'; // feature:email-password
import { NativeRecoveryService } from './native-recovery.service'; // feature:email-password

@Module({
  imports: [
    CommonModule,
    AuthModule,
    NativeAuthModule,
    UserModule,
    SessionModule,
    MailModule, // feature:magic-link,email-password
    MagicLinkModule, // feature:magic-link
  ],
  controllers: [
    NativeEmailLinkController, // feature:magic-link
    NativeRegistrationController, // feature:email-password
    NativeRecoveryController, // feature:email-password
  ],
  providers: [
    NativeEmailLinkService, // feature:magic-link
    NativeEmailLinkMailService, // feature:magic-link
    NativeRegistrationService, // feature:email-password
    NativeRecoveryService, // feature:email-password
  ],
})
export class NativeLifecycleModule {}

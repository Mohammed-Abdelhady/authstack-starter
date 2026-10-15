import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AuthContractsModule } from '../../auth/contracts/auth-contracts.module';
import { EmailChangeConfirmationService } from '../../auth/services/registration/email-change-confirmation.service';
import { CommonModule } from '../../common/common.module';
import { MailModule } from '../../mail/mail.module';
import { SessionModule } from '../../session/session.module';
import { UserModule } from '../user.module';
import { NativeEmailChangeController } from './native-email-change.controller';
import { OwnEmailController } from './own-email.controller';
import { NativeEmailChangeService } from './services/native-email-change.service';
import { OwnEmailConfirmationService } from './services/own-email-confirmation.service';
import { OwnEmailMailService } from './services/own-email-mail.service';
import { OwnEmailRequestService } from './services/own-email-request.service';

/**
 * The account holder's own address change, and the confirmation a mobile app
 * makes for a change staff started. The confirmation service is the public
 * route's, built here again because the auth module keeps it to itself.
 */
@Module({
  imports: [
    CommonModule,
    MailModule,
    SessionModule,
    AuthContractsModule,
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
  ],
  controllers: [OwnEmailController, NativeEmailChangeController],
  providers: [
    OwnEmailRequestService,
    OwnEmailConfirmationService,
    OwnEmailMailService,
    NativeEmailChangeService,
    EmailChangeConfirmationService,
  ],
})
export class UserEmailModule {}

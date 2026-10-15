import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { MailModule } from '../../mail/mail.module';
import { MailService } from '../../mail/mail.service';
import { EnrolmentPromotion } from './enrolment-promotion';
import { NoopEnrolmentPromotion } from './defaults/noop-enrolment-promotion';
import { ErasureLock } from './erasure-lock';
import { FreshProofCheck, FreshProofSender } from './fresh-proof';
import { DisabledErasureLock } from './defaults/disabled-erasure-lock';
import { SessionFreshProofCheck } from './defaults/session-fresh-proof-check';

@Module({
  imports: [CommonModule, MailModule],
  providers: [
    { provide: FreshProofCheck, useClass: SessionFreshProofCheck },
    { provide: FreshProofSender, useExisting: MailService },
    { provide: ErasureLock, useClass: DisabledErasureLock },
    { provide: EnrolmentPromotion, useClass: NoopEnrolmentPromotion },
  ],
  exports: [FreshProofCheck, FreshProofSender, ErasureLock, EnrolmentPromotion],
})
export class AuthContractsModule {}

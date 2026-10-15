import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { MailModule } from '../../mail/mail.module';
import { MailService } from '../../mail/mail.service';
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
  ],
  exports: [FreshProofCheck, FreshProofSender, ErasureLock],
})
export class AuthContractsModule {}

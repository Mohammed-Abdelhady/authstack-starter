import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { MailModule } from '../../mail/mail.module';
import { MailService } from '../../mail/mail.service';
import { SessionModule } from '../../session/session.module';
import { ErasureModule } from '../../user/erasure/erasure.module';
import { StoredErasureLock } from '../../user/erasure/services/stored-erasure-lock';
import { ErasureLock } from './erasure-lock';
import { FreshProofCheck, FreshProofSender } from './fresh-proof';
import { SessionFreshProofCheck } from './defaults/session-fresh-proof-check';

@Module({
  imports: [CommonModule, MailModule, SessionModule, ErasureModule],
  providers: [
    { provide: FreshProofCheck, useClass: SessionFreshProofCheck },
    { provide: FreshProofSender, useExisting: MailService },
    { provide: ErasureLock, useExisting: StoredErasureLock },
  ],
  exports: [FreshProofCheck, FreshProofSender, ErasureLock, SessionModule],
})
export class AuthContractsModule {}

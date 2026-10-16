import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { MailModule } from '../../mail/mail.module';
import { SessionModule } from '../../session/session.module';
import {
  HOST_ERASURE_HOOK,
  HOST_ERASURE_HOOK_IMPORTS,
} from '../../host/account-erasure';
import { ProviderTokensModule } from '../../auth/oauth/provider-tokens/provider-tokens.module'; // feature:oauth-core
import { AccountErasureHook } from './account-erasure-hook';
import { AdminErasureJobsController } from './admin-erasure-jobs.controller';
import { ERASURE_PERSISTENCE_PROVIDERS } from './persistence/erasure-persistence';
import { ErasureJobsAdminService } from './services/erasure-jobs-admin.service';
import { ErasureSettings } from './services/erasure-settings';
import { ErasureWorker } from './services/erasure-worker';
import { StoredErasureLock } from './services/stored-erasure-lock';

/**
 * Erasing deleted accounts, and the receipts of deletions. Imported by the
 * user module for the deletion route and by the contracts module for the lock
 * a restore takes; Nest builds it once for both.
 */
@Module({
  imports: [
    CommonModule,
    SessionModule,
    MailModule,
    ...HOST_ERASURE_HOOK_IMPORTS,
    ProviderTokensModule, // feature:oauth-core
  ],
  controllers: [AdminErasureJobsController],
  providers: [
    ErasureSettings,
    ErasureWorker,
    ErasureJobsAdminService,
    StoredErasureLock,
    { provide: AccountErasureHook, useClass: HOST_ERASURE_HOOK },
    ...ERASURE_PERSISTENCE_PROVIDERS,
  ],
  exports: [StoredErasureLock],
})
export class ErasureModule {}

import { Module } from '@nestjs/common';
import { HashService } from './services/hash.service';
import { Clock } from './services/clock';
import { AuthEpochService } from './services/auth-epoch.service';
import { IdFormat } from './persistence/id-format';
import { COMMON_PERSISTENCE_PROVIDERS } from './persistence/common-persistence';

@Module({
  providers: [
    HashService,
    Clock,
    AuthEpochService,
    ...COMMON_PERSISTENCE_PROVIDERS,
  ],
  exports: [HashService, Clock, AuthEpochService, IdFormat],
})
export class CommonModule {}

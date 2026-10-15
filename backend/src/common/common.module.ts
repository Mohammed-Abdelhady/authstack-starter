import { Module } from '@nestjs/common';
import { HashService } from './services/hash.service';
import { Clock } from './services/clock';
import { AuthEpochService } from './services/auth-epoch.service';
import { IdFormat } from './persistence/id-format';
import { AddressLedger } from './persistence/address-ledger';
import {
  COMMON_PERSISTENCE_IMPORTS,
  COMMON_PERSISTENCE_PROVIDERS,
} from './persistence/common-persistence';

@Module({
  imports: [...COMMON_PERSISTENCE_IMPORTS],
  providers: [
    HashService,
    Clock,
    AuthEpochService,
    ...COMMON_PERSISTENCE_PROVIDERS,
  ],
  exports: [HashService, Clock, AuthEpochService, IdFormat, AddressLedger],
})
export class CommonModule {}

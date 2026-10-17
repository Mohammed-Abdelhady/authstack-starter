// Configuration must select storage before persistence modules are loaded.
import { APP_CONFIGURATION } from '../../../config/app-configuration';
import { Module } from '@nestjs/common';
import { Clock } from '../../../common/services/clock';
import { STORAGE_CONNECTION_IMPORTS } from '../../../common/persistence/common-persistence';
import { ERASURE_PERSISTENCE_PROVIDERS } from '../persistence/erasure-persistence';
import { ErasureSettings } from '../services/erasure-settings';
import { ErasureScheduleCommand } from './erasure-schedule.command';

@Module({
  imports: [APP_CONFIGURATION, ...STORAGE_CONNECTION_IMPORTS],
  providers: [
    Clock,
    ErasureSettings,
    ErasureScheduleCommand,
    ...ERASURE_PERSISTENCE_PROVIDERS,
  ],
})
export class ErasureScheduleModule {}

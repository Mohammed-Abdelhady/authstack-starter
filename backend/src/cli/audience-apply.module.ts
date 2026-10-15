// Configuration must select storage before persistence modules are loaded.
import { APP_CONFIGURATION } from '../config/app-configuration';
import { Module } from '@nestjs/common';
import { Clock } from '../common/services/clock';
import { STORAGE_CONNECTION_IMPORTS } from '../common/persistence/common-persistence';
import { SessionRevoker } from '../session/revocation/session-revoker';
import { AudienceApplyService } from './audience-apply.service';
import {
  AUDIENCE_COMMAND_IMPORTS,
  AUDIENCE_COMMAND_PROVIDERS,
} from './persistence/audience-command-persistence';

@Module({
  imports: [
    APP_CONFIGURATION,
    ...STORAGE_CONNECTION_IMPORTS,
    ...AUDIENCE_COMMAND_IMPORTS,
  ],
  providers: [
    Clock,
    AudienceApplyService,
    SessionRevoker,
    ...AUDIENCE_COMMAND_PROVIDERS,
  ],
})
export class AudienceApplyModule {}

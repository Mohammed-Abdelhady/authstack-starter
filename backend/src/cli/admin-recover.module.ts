import { APP_CONFIGURATION } from '../config/app-configuration';
import { Module } from '@nestjs/common';
import { AdminCommandModule } from './admin-command.module';
import { AdminRecoverService } from './admin-recover.service';

@Module({
  imports: [APP_CONFIGURATION, AdminCommandModule],
  providers: [AdminRecoverService],
})
export class AdminRecoverModule {}

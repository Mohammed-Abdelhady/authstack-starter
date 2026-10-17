import { APP_CONFIGURATION } from '../config/app-configuration';
import { Module } from '@nestjs/common';
import { AdminCommandModule } from './admin-command.module';
import { AdminInviteService } from './admin-invite.service';

@Module({
  imports: [APP_CONFIGURATION, AdminCommandModule],
  providers: [AdminInviteService],
})
export class AdminInviteModule {}

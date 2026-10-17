import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../../common/common.module';
import { MailModule } from '../../mail/mail.module';
import { SessionModule } from '../../session/session.module';
import { ErasureModule } from '../../user/erasure/erasure.module';
import { UserModule } from '../../user/user.module';
import { AuthModule } from '../auth.module';
import {
  MAGIC_LINK_PERSISTENCE_IMPORTS,
  MAGIC_LINK_PERSISTENCE_PROVIDERS,
} from '../magic-link/persistence/magic-link-persistence';
import { EMAIL_CODE_PERSISTENCE_PROVIDERS } from '../persistence/email-code-persistence';
import { NativeEmailCodeCeilingService } from '../native/lifecycle/native-email-code-ceiling.service';
import { BROWSER_EMAIL_CODE_PROVIDERS } from './browser-email-code.providers';
import { BrowserEmailCodeController } from './browser-email-code.controller';

@Module({
  imports: [
    CommonModule,
    ConfigModule,
    MailModule,
    SessionModule,
    ErasureModule,
    AuthModule,
    UserModule,
    ...MAGIC_LINK_PERSISTENCE_IMPORTS,
  ],
  providers: [
    ...MAGIC_LINK_PERSISTENCE_PROVIDERS,
    ...EMAIL_CODE_PERSISTENCE_PROVIDERS,
    NativeEmailCodeCeilingService,
    ...BROWSER_EMAIL_CODE_PROVIDERS,
  ],
  controllers: [BrowserEmailCodeController],
})
export class BrowserEmailCodeModule {}

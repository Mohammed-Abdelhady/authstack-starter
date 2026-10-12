import { Module } from '@nestjs/common';
import { NativeAuthModule } from '../native-auth.module';
import { SessionModule } from '../../../session/session.module';
import { NativeProviderController } from './native-provider.controller';
import { NativeProviderService } from './native-provider.service';

@Module({
  imports: [NativeAuthModule, SessionModule],
  controllers: [NativeProviderController],
  providers: [NativeProviderService],
})
export class NativeProviderModule {}

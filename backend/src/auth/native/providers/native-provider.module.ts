import { Module } from '@nestjs/common';
import { NativeAuthModule } from '../native-auth.module';
import { NativeProviderController } from './native-provider.controller';
import { NativeProviderService } from './native-provider.service';

@Module({
  imports: [NativeAuthModule],
  controllers: [NativeProviderController],
  providers: [NativeProviderService],
})
export class NativeProviderModule {}

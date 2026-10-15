import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../../common/common.module';
import {
  PASSKEY_STORE_IMPORTS,
  PASSKEY_STORE_PROVIDERS,
} from './persistence/passkey-store-persistence';
import { PasskeyStore } from './stores/passkey.store';
import { PasskeyConfigService } from './services/passkey-config.service';
import { LegacyPasskeyFacts } from './services/legacy-passkey-facts';

/** Read-only facts without AuthModule, SessionModule or sign-in completion. */
@Module({
  imports: [CommonModule, ConfigModule, ...PASSKEY_STORE_IMPORTS],
  providers: [
    ...PASSKEY_STORE_PROVIDERS,
    PasskeyConfigService,
    LegacyPasskeyFacts,
  ],
  exports: [PasskeyStore, PasskeyConfigService, LegacyPasskeyFacts],
})
export class LegacyPasskeyFactsModule {}

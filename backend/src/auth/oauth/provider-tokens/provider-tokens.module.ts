import { Module } from '@nestjs/common';
import { CommonModule } from '../../../common/common.module';
import { SessionModule } from '../../../session/session.module';
import { AdminProviderRevocationsController } from './admin-provider-revocations.controller';
import { PROVIDER_TOKEN_PERSISTENCE_PROVIDERS } from './persistence/provider-token-persistence';
import { ProviderRevocationRunner } from './services/provider-revocation-runner';
import { ProviderRevocations } from './services/provider-revocations';
import { ProviderTokenCrypto } from './services/provider-token-crypto';
import { ProviderTokenVault } from './services/provider-token-vault';
import { RegistryRevocableProviders } from './services/registry-revocable-providers';
import { RevocableProviders } from './revocable-provider';
import { ProviderTokenStore } from './stores/provider-token.store';

/**
 * Provider refresh tokens kept for revocation, and the runner that revokes
 * them. Imported by the user module, which hands it on to the OAuth module.
 */
@Module({
  imports: [CommonModule, SessionModule],
  controllers: [AdminProviderRevocationsController],
  providers: [
    ProviderTokenCrypto,
    ProviderTokenVault,
    ProviderRevocations,
    { provide: RevocableProviders, useClass: RegistryRevocableProviders },
    ProviderRevocationRunner,
    ...PROVIDER_TOKEN_PERSISTENCE_PROVIDERS,
  ],
  exports: [ProviderTokenVault, ProviderRevocations, ProviderTokenStore],
})
export class ProviderTokensModule {}

import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OAuthRegistryService } from '../../oauth-registry.service';
import {
  isRevocableProvider,
  RevocableProviders,
  type RevocableProvider,
} from '../revocable-provider';

/**
 * Looks the strategy up in the OAuth registry. The registry belongs to the
 * OAuth module, registered with its providers apart from this one, so it is
 * found the way native sign-in finds it.
 */
@Injectable()
export class RegistryRevocableProviders extends RevocableProviders {
  constructor(private readonly modules: ModuleRef) {
    super();
  }

  find(providerId: string): RevocableProvider | undefined {
    const registry = this.modules.get(OAuthRegistryService, { strict: false });
    if (!registry.isEnabled(providerId)) return undefined;
    const strategy = registry.get(providerId);
    return isRevocableProvider(strategy) ? strategy : undefined;
  }
}

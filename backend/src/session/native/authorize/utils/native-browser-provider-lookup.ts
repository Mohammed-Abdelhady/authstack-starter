import type { ModuleRef } from '@nestjs/core';
import type {
  NativeBrowserMethodLookup,
  NativeBrowserProviderLookup,
} from '../types/native-browser-selectors';
import { AuthFeaturesService } from '../../../../auth/services/features/auth-features.service';
import { AuthFeature } from '../../../../auth/enums/auth-feature.enum';
import { OAuthRegistryService } from '../../../../auth/oauth/oauth-registry.service'; // feature:oauth-core

export function nativeBrowserProviderLookup(
  _moduleRef: ModuleRef,
): NativeBrowserMethodLookup {
  return {
    isEnabled(_providerId) {
      try {
        const registries: readonly NativeBrowserProviderLookup[] = [
          _moduleRef.get(OAuthRegistryService, { strict: false }), // feature:oauth-core
        ];
        return registries.some((registry) => registry.isEnabled(_providerId));
      } catch {
        return false;
      }
    },
    isPasswordEnabled() {
      try {
        return _moduleRef
          .get(AuthFeaturesService, { strict: false })
          .isEnabled(AuthFeature.PASSWORD);
      } catch {
        return false;
      }
    },
  };
}

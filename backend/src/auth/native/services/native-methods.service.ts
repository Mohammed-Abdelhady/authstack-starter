import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { NativeMethods, NativeProviderMethod } from '@app/sdk';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { OAuthRegistryService } from '../../oauth/oauth-registry.service'; // feature:oauth-core
import type { NativeProviderSignInConfiguration } from '../../../config/types/native-application.type';
import { ApplicationRegistry } from '../../../session/applications/application-registry';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../../session/constants/client-ids';

@Injectable()
export class NativeMethodsService {
  constructor(
    private readonly epoch: AuthEpochService,
    private readonly features: AuthFeaturesService,
    private readonly modules: ModuleRef,
    private readonly applications: ApplicationRegistry,
  ) {}

  async forClient(clientId: string): Promise<NativeMethods> {
    const application = this.epoch
      .nativeApplications()
      .find((item) => item.clientId === clientId);
    const registered = await this.applications.lookUpClient(clientId);
    const signIn = application?.signIn;
    const enabled =
      this.epoch.nativeEnabled() &&
      signIn !== undefined &&
      registered?.enabled === true &&
      registered.platform === APPLICATION_PLATFORM.NATIVE &&
      registered.clientType === APPLICATION_CLIENT_TYPE.PUBLIC;
    const registry = this.registry();
    const oauth = registry?.listEnabled() ?? [];
    const providers = oauth.map((provider) => {
      const sdk = enabled
        ? signIn.providers?.find((entry) => entry.id === provider.id)
        : undefined;
      return sdk
        ? this.provider(sdk, provider.displayName)
        : {
            id: provider.id,
            displayName: provider.displayName,
            mode: 'system' as const,
          };
    });
    const passwordFeature = this.features.isEnabled(AuthFeature.PASSWORD);
    const emailLinkFeature = this.features.isEnabled(AuthFeature.MAGIC_LINK);
    const passkeyFeature = this.features.isEnabled(AuthFeature.PASSKEYS);
    const twoFactorFeature = this.features.isEnabled(AuthFeature.TWO_FACTOR);
    const password = enabled && signIn?.password === true && passwordFeature;
    const emailLink = enabled && signIn?.emailLink === true && emailLinkFeature;
    const passkeys =
      enabled &&
      signIn?.passkeys === true &&
      Boolean(signIn.rpId && signIn.origins?.length) &&
      passkeyFeature;
    return {
      nativeEnabled: enabled,
      methods: {
        password: passwordFeature,
        magicLink: emailLinkFeature,
        twoFactor: twoFactorFeature,
        passkeys: passkeyFeature,
        oauth,
      },
      capabilities: {
        password,
        emailLink,
        passkeys,
        registration:
          enabled && signIn?.registration === true && passwordFeature,
        recovery: enabled && signIn?.recovery === true && passwordFeature,
      },
      providers,
    };
  }

  policyHash(clientId: string): string | null {
    if (!this.epoch.nativeEnabled()) return null;
    const application = this.epoch
      .nativeApplications()
      .find((item) => item.clientId === clientId);
    if (!application?.signIn) return null;
    return createHash('sha256')
      .update(JSON.stringify(application))
      .digest('hex');
  }

  private registry(): OAuthRegistryService | null {
    try {
      return this.modules.get(OAuthRegistryService, { strict: false });
    } catch {
      return null;
    }
  }

  private provider(
    entry: NativeProviderSignInConfiguration,
    displayName: string,
  ): NativeProviderMethod {
    const base = { id: entry.id, displayName };
    switch (entry.mode) {
      case 'googleIdentityToken':
        return {
          ...base,
          mode: entry.mode,
          sdk: {
            kind: 'google',
            webClientId: entry.webClientId ?? '',
            iosClientId: entry.iosClientId,
          },
        };
      case 'appleIdentityTokenAndCode':
        return {
          ...base,
          mode: entry.mode,
          sdk: { kind: 'apple', appId: entry.appId ?? '' },
        };
      case 'facebook':
        return {
          ...base,
          mode: entry.mode,
          sdk: { kind: 'facebook', appId: entry.appId ?? '' },
        };
      default:
        return { ...base, mode: 'system' };
    }
  }
}

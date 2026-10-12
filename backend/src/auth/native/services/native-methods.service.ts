import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { NativeMethods, NativeProviderMethod } from '@app/sdk';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { OAuthRegistryService } from '../../oauth/oauth-registry.service';
import type {
  NativeApplicationConfiguration,
  NativeProviderSignInConfiguration,
} from '../../../config/types/native-application.type';
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
    const registry = this.modules.get(OAuthRegistryService, { strict: false });
    const providers =
      enabled && application ? this.providers(application, registry) : [];
    const password =
      enabled &&
      signIn?.password === true &&
      this.features.isEnabled(AuthFeature.PASSWORD);
    const emailLink =
      enabled &&
      signIn?.emailLink === true &&
      this.features.isEnabled(AuthFeature.MAGIC_LINK);
    const passkeys =
      enabled &&
      signIn?.passkeys === true &&
      Boolean(signIn.rpId && signIn.origins?.length) &&
      this.features.isEnabled(AuthFeature.PASSKEYS);
    return {
      nativeEnabled: enabled,
      methods: {
        password,
        magicLink: emailLink,
        twoFactor: enabled && this.features.isEnabled(AuthFeature.TWO_FACTOR),
        passkeys,
        oauth: providers.map(({ id, displayName }) => ({ id, displayName })),
      },
      capabilities: {
        password,
        emailLink,
        passkeys,
        registration: enabled && signIn?.registration === true,
        recovery: enabled && signIn?.recovery === true,
      },
      providers,
    };
  }

  private providers(
    application: NativeApplicationConfiguration,
    registry: OAuthRegistryService,
  ): NativeProviderMethod[] {
    return (application.signIn?.providers ?? [])
      .filter(({ id }) => registry.isEnabled(id))
      .map((entry) => this.provider(entry, registry.get(entry.id).displayName));
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

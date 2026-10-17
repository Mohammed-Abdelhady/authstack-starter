import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { NativeProviderCredential, NativeProviderMethod } from '@app/sdk';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import type { SupportedLocale } from '../../../common/constants/locales';
import { AudienceAdmissionRefused } from '../../../session/utils/authority/audience-admission';
import { EventRecorder } from '../../contracts/event-recorder';
import { providerAuthenticationFailed } from '../../oauth/oauth-account-rules';
import { nativeAudienceRefusal } from '../utils/native-audience-refusal';
import {
  runLeavingFailuresAsRaised,
  storeFailureCause,
} from '../../../common/persistence/store-failure';
import { OAuthRegistryService } from '../../oauth/oauth-registry.service';
import { OAuthService } from '../../oauth/oauth.service';
import { NativeAttemptService } from '../services/native-attempt.service';
import { NativeMethodsService } from '../services/native-methods.service';
import {
  NATIVE_ATTEMPT_FIRST_FACTOR,
  NATIVE_ATTEMPT_FLOW,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import {
  featureDisabled,
  invalidRequest,
  wrongStage,
} from '../utils/native-attempt-errors';

const PROVIDER_ID = {
  googleIdentityToken: 'google',
  appleIdentityTokenAndCode: 'apple',
  facebookLimitedToken: 'facebook',
  facebookAccessToken: 'facebook',
} as const;

@Injectable()
export class NativeProviderService {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly methods: NativeMethodsService,
    private readonly modules: ModuleRef,
    private readonly runner: UnitOfWorkRunner,
    private readonly events: EventRecorder,
  ) {}

  async verify(
    attemptId: string,
    secret: string,
    credential: NativeProviderCredential,
    locale: SupportedLocale,
  ) {
    const claimed = await this.attempts.claim(
      attemptId,
      secret,
      NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
    );
    let transitioned = false;
    try {
      if (claimed.flow !== NATIVE_ATTEMPT_FLOW.SIGN_IN) throw wrongStage();
      const catalogue = await this.methods.forClient(claimed.clientId);
      const method = catalogue.providers.find(
        (entry) => entry.id === PROVIDER_ID[credential.kind],
      );
      if (
        !catalogue.nativeEnabled ||
        !method ||
        !matchesMode(method, credential)
      )
        throw featureDisabled();
      const nonceDigest = claimed.details.nonceDigest;
      if (
        !nonceDigest ||
        ('nonceDigest' in credential && credential.nonceDigest !== nonceDigest)
      )
        throw invalidRequest();
      const registry = this.modules.get(OAuthRegistryService, {
        strict: false,
      });
      const strategy = registry.getEnabled(method.id);
      if (!strategy.verifyNativeCredential) throw featureDisabled();
      const profile = await strategy.verifyNativeCredential({
        credential,
        method,
        nonceDigest,
      });
      const current = await this.attempts.authenticate(attemptId, secret);
      if (
        current.activeOperationId !== claimed.activeOperationId ||
        current.revision !== claimed.revision
      )
        throw wrongStage();
      const oauth = this.modules.get(OAuthService, { strict: false });
      const account = await oauth
        .resolveVerifiedProfile(strategy, profile, locale, claimed.clientId)
        .catch((error: unknown) => {
          const cause = storeFailureCause(error);
          if (cause instanceof AudienceAdmissionRefused)
            throw providerAuthenticationFailed(method.id);
          throw error;
        });
      const completed = await runLeavingFailuresAsRaised(this.runner, (work) =>
        this.attempts.completeFactorIn(
          work,
          claimed,
          {
            userId: account.id,
            userVersion: account.sessionVersion,
            firstFactor: NATIVE_ATTEMPT_FIRST_FACTOR.PROVIDER,
            authenticationMethods: [`provider:${method.id}`],
          },
          secret,
        ),
      ).catch(async (error: unknown) => {
        throw (
          (await nativeAudienceRefusal(
            error,
            this.events,
            claimed.clientId,
            () => providerAuthenticationFailed(method.id),
            account.id,
          )) ?? error
        );
      });
      transitioned = true;
      return this.attempts.viewAfter(completed, secret);
    } finally {
      if (!transitioned)
        await this.attempts.release(claimed).catch(() => undefined);
    }
  }
}

function matchesMode(
  method: NativeProviderMethod,
  credential: NativeProviderCredential,
): boolean {
  return (
    method.mode === credential.kind ||
    (method.mode === 'facebook' &&
      (credential.kind === 'facebookLimitedToken' ||
        credential.kind === 'facebookAccessToken'))
  );
}

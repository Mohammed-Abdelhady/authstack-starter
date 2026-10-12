import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  NativeAttemptStart,
  NativeAttemptStartResult,
  NativeAttemptView,
} from '@app/sdk';
import { Clock } from '../../../common/services/clock';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { runLeavingFailuresAsRaised } from '../../../common/persistence/store-failure';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { hashToken } from '../../../session/utils/hashing/token-hash';
import { ApplicationRegistry } from '../../../session/applications/application-registry';
import { ApplicationAccessStore } from '../../../session/applications/application-access.store';
import { BrowserIssuanceStore } from '../../../session/issuance/browser-issuance.store';
import { NativeAuthorizeService } from '../../../session/native/authorize/native-authorize.service';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import {
  NATIVE_ATTEMPT_FIRST_FACTOR,
  NATIVE_ATTEMPT_FLOW,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import { NativeAttemptStore } from '../stores/native-attempt.store';
import type {
  NativeAttempt,
  VerifiedNativePrincipal,
} from '../types/native-attempt';
import { NativeMethodsService } from './native-methods.service';
import { NativeAttemptViewService } from './native-attempt-view.service';
import { isFirstFactorClaim } from '../utils/native-first-factor-claim';
import { nativeFirstFactors } from '../utils/native-first-factors';
import { assertNativePolicy } from '../utils/native-policy.util';
import { guardOf, operationGuardOf } from '../utils/native-attempt-guards';
export { guardOf, operationGuardOf } from '../utils/native-attempt-guards';
import {
  featureDisabled,
  invalidRequest,
  unauthorizedAttempt,
  expiredAttempt,
  wrongStage,
} from '../utils/native-attempt-errors';

const ATTEMPT_LIFETIME_MS = 15 * 60 * 1000;

@Injectable()
export class NativeAttemptService {
  constructor(
    private readonly attempts: NativeAttemptStore,
    private readonly methods: NativeMethodsService,
    private readonly authorize: NativeAuthorizeService,
    private readonly registry: ApplicationRegistry,
    private readonly grants: ApplicationAccessStore,
    private readonly issuance: BrowserIssuanceStore,
    private readonly accounts: AccountProfileStore,
    private readonly features: AuthFeaturesService,
    private readonly clock: Clock,
    private readonly epoch: AuthEpochService,
    private readonly runner: UnitOfWorkRunner,
    private readonly views: NativeAttemptViewService,
  ) {}

  async start(input: NativeAttemptStart): Promise<NativeAttemptStartResult> {
    this.assertEnabled();
    if (
      !input ||
      !Object.values(NATIVE_ATTEMPT_FLOW).some((flow) => flow === input.flow) ||
      !Array.isArray(input.scopes) ||
      input.scopes.some((scope) => typeof scope !== 'string')
    ) {
      throw invalidRequest();
    }
    const methods = await this.methods.forClient(input.clientId);
    if (!methods.nativeEnabled) throw featureDisabled();
    const factors = nativeFirstFactors(methods);
    if (
      factors.length === 0 ||
      (input.flow === NATIVE_ATTEMPT_FLOW.REGISTRATION &&
        !methods.capabilities.registration) ||
      (input.flow === NATIVE_ATTEMPT_FLOW.RECOVERY &&
        !methods.capabilities.recovery)
    )
      throw featureDisabled();

    const validated = await this.authorize.validateRequest({
      response_type: 'code',
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      code_challenge_method: input.codeChallengeMethod,
      state: input.state,
      scope: input.scopes.join(' '),
    });
    if ('ok' in validated) throw invalidRequest();
    const now = this.clock.now();
    const secret = randomBytes(32).toString('base64url');
    const nonceDigest = hashToken(randomBytes(32).toString('base64url'));
    const created = await this.attempts.create({
      attemptId: randomUUID(),
      secretHash: hashToken(secret),
      clientId: validated.clientId,
      redirectUri: validated.redirectUri,
      codeChallenge: validated.codeChallenge,
      state: validated.state,
      requestedScopes: validated.requestedScopes,
      flow: input.flow,
      phase: NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
      authEpoch: this.epoch.current(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + ATTEMPT_LIFETIME_MS),
      details: {
        policyHash: this.methods.policyHash(validated.clientId) ?? undefined,
        verifiedAccount: null,
        nonceDigest,
        email: null,
        codeReply: null,
      },
    });
    return {
      attemptId: created.attemptId,
      expiresAt: created.expiresAt.toISOString(),
      stage: 'firstFactorRequired',
      factors,
      attemptSecret: secret,
      providerNonceDigest: nonceDigest,
    };
  }

  async authenticate(
    attemptId: string,
    secret: string,
  ): Promise<NativeAttempt> {
    this.assertEnabled();
    if (
      !/^[A-Za-z0-9_-]{43}$/u.test(secret) ||
      !attemptId ||
      attemptId.length > 128
    ) {
      throw unauthorizedAttempt();
    }
    const attempt = await this.attempts.findAuthenticated(
      attemptId,
      hashToken(secret),
    );
    if (!attempt) throw unauthorizedAttempt();
    if (attempt.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw expiredAttempt();
    }
    assertNativePolicy(
      attempt,
      this.methods.policyHash(attempt.clientId),
      this.epoch.current(),
    );
    return attempt;
  }

  async claim(
    attemptId: string,
    secret: string,
    phase: NativeAttempt['phase'],
  ): Promise<NativeAttempt> {
    const attempt = await this.authenticate(attemptId, secret);
    if (attempt.phase !== phase || attempt.activeOperationId)
      throw wrongStage();
    const claimed = await this.attempts.claim(guardOf(attempt), randomUUID());
    if (!claimed) throw wrongStage();
    return claimed;
  }

  async claimIn(
    unitOfWork: UnitOfWork,
    attemptId: string,
    secret: string,
    phase: NativeAttempt['phase'],
  ): Promise<NativeAttempt> {
    const attempt = await this.authenticate(attemptId, secret);
    if (attempt.phase !== phase || attempt.activeOperationId)
      throw wrongStage();
    const claimed = await this.attempts.claimIn(
      unitOfWork,
      guardOf(attempt),
      randomUUID(),
    );
    if (!claimed) throw wrongStage();
    return claimed;
  }

  async release(claimed: NativeAttempt): Promise<void> {
    const operation = operationGuardOf(claimed);
    if (!(await this.attempts.release(operation))) throw wrongStage();
  }

  async transition(
    claimed: NativeAttempt,
    phase: NativeAttempt['phase'],
    details: NativeAttempt['details'],
  ): Promise<NativeAttempt> {
    const transitioned = await this.attempts.transition(
      operationGuardOf(claimed),
      {
        phase,
        expiresAt: claimed.expiresAt,
        details,
      },
    );
    if (!transitioned) throw wrongStage();
    return transitioned;
  }

  async completeFactor(
    attemptId: string,
    secret: string,
    principal: VerifiedNativePrincipal,
  ): Promise<NativeAttemptView> {
    const completed = await runLeavingFailuresAsRaised(
      this.runner,
      async (unitOfWork) => {
        const current = await this.authenticate(attemptId, secret);
        const claimed = await this.claimIn(
          unitOfWork,
          attemptId,
          secret,
          current.phase,
        );
        return this.completeFactorIn(unitOfWork, claimed, principal);
      },
    );
    return this.view(completed);
  }

  async completeFactorIn(
    unitOfWork: UnitOfWork,
    claimed: NativeAttempt,
    principal: VerifiedNativePrincipal,
  ): Promise<NativeAttempt> {
    assertNativePolicy(
      claimed,
      this.methods.policyHash(claimed.clientId),
      this.epoch.current(),
    );
    if (
      !isFirstFactorClaim(claimed, principal) ||
      !claimed.activeOperationId ||
      !principal.userId ||
      !Array.isArray(principal.authenticationMethods) ||
      principal.authenticationMethods.length === 0
    )
      throw wrongStage();
    const authority = await this.issuance.readAccountForIssuance(
      unitOfWork,
      principal.userId,
    );
    if (
      !authority ||
      authority.isDeleted ||
      authority.sessionVersion !== principal.userVersion
    )
      throw wrongStage();
    const account = await this.accounts.readAccount(
      unitOfWork,
      principal.userId,
    );
    const client = await this.registry.findClientIn(
      unitOfWork,
      claimed.clientId,
    );
    if (
      !account ||
      account.isDeleted ||
      account.sessionVersion !== principal.userVersion ||
      !client ||
      !client.enabled
    )
      throw wrongStage();
    const grant = await this.grants.takeGrantForChange(
      unitOfWork,
      account.id,
      claimed.clientId,
    );
    if (grant && !grant.allowed) throw wrongStage();
    const owesMfa =
      account.twoFactorEnabled &&
      this.features.isEnabled(AuthFeature.TWO_FACTOR) &&
      !(
        principal.firstFactor === NATIVE_ATTEMPT_FIRST_FACTOR.PASSKEY &&
        principal.passkeyUserVerified === true
      );
    const phase = owesMfa
      ? NATIVE_ATTEMPT_PHASE.SECOND_FACTOR_REQUIRED
      : NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED;
    const completed = await this.attempts.transitionIn(
      unitOfWork,
      operationGuardOf(claimed),
      {
        phase,
        expiresAt: claimed.expiresAt,
        details: {
          ...claimed.details,
          verifiedAccount: {
            userId: account.id,
            userVersion: principal.userVersion,
            clientVersion: client.sessionVersion,
            grantVersion: grant?.sessionVersion ?? null,
            authenticationMethods: principal.authenticationMethods.slice(0, 10),
            firstFactor: principal.firstFactor,
            verifiedAt: this.clock.now(),
          },
          secondFactors: owesMfa ? ['totp', 'recoveryCode'] : undefined,
        },
      },
    );
    if (!completed) throw wrongStage();
    return completed;
  }

  async view(attempt: NativeAttempt): Promise<NativeAttemptView> {
    return this.views.view(attempt);
  }

  async cancel(attemptId: string, secret: string): Promise<NativeAttemptView> {
    const attempt = await this.authenticate(attemptId, secret);
    if (!(await this.attempts.cancel(guardOf(attempt)))) throw wrongStage();
    return {
      attemptId,
      expiresAt: attempt.expiresAt.toISOString(),
      stage: 'denied',
      reason: 'cancelled',
    };
  }

  private assertEnabled(): void {
    if (!this.epoch.nativeEnabled()) throw featureDisabled();
  }
}

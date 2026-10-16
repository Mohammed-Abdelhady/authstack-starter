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
import { NativeAuthorizeService } from '../../../session/native/authorize/native-authorize.service';
import { NATIVE_ATTEMPT_PHASE } from '../constants/native-attempt';
import { NativeAttemptStore } from '../stores/native-attempt.store';
import type {
  NativeAttempt,
  VerifiedNativePrincipal,
} from '../types/native-attempt';
import { NativeMethodsService } from './native-methods.service';
import { NativeAttemptViewService } from './native-attempt-view.service';
import { nativeFirstFactors } from '../utils/native-first-factors';
import {
  assertNativeEnabled,
  assertNativePolicy,
} from '../utils/native-policy.util';
import {
  isNativeAttemptStart,
  nativeAttemptFlowAvailable,
} from '../utils/native-attempt-start';
import { guardOf, operationGuardOf } from '../utils/native-attempt-guards';
export { guardOf, operationGuardOf } from '../utils/native-attempt-guards';
import {
  featureDisabled,
  invalidRequest,
  unauthorizedAttempt,
  expiredAttempt,
  wrongStage,
} from '../utils/native-attempt-errors';
import { NativeAttemptCompletionService } from './native-attempt-completion.service';

const ATTEMPT_LIFETIME_MS = 15 * 60 * 1000;

@Injectable()
export class NativeAttemptService {
  constructor(
    private readonly attempts: NativeAttemptStore,
    private readonly methods: NativeMethodsService,
    private readonly authorize: NativeAuthorizeService,
    private readonly clock: Clock,
    private readonly epoch: AuthEpochService,
    private readonly runner: UnitOfWorkRunner,
    private readonly views: NativeAttemptViewService,
    private readonly completion: NativeAttemptCompletionService,
  ) {}

  async start(input: NativeAttemptStart): Promise<NativeAttemptStartResult> {
    assertNativeEnabled(this.epoch);
    if (!isNativeAttemptStart(input)) throw invalidRequest();
    const methods = await this.methods.forClient(input.clientId);
    if (!methods.nativeEnabled) throw featureDisabled();
    const factors = nativeFirstFactors(methods);
    if (!nativeAttemptFlowAvailable(input.flow, methods, factors.length))
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
    assertNativeEnabled(this.epoch);
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
        return this.completeFactorIn(unitOfWork, claimed, principal, secret);
      },
    );
    return this.viewAfter(completed, secret);
  }

  async completeFactorIn(
    unitOfWork: UnitOfWork,
    claimed: NativeAttempt,
    principal: VerifiedNativePrincipal,
    secret: string,
  ): Promise<NativeAttempt> {
    return this.completion.afterFirstFactorIn(
      unitOfWork,
      claimed,
      principal,
      secret,
    );
  }

  async viewAfter(
    attempt: NativeAttempt,
    secret: string,
  ): Promise<NativeAttemptView> {
    return attempt.phase === NATIVE_ATTEMPT_PHASE.CODE_READY
      ? this.completion.codeReadyView(attempt, secret)
      : this.view(attempt);
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
}

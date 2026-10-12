import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NativeAttemptView } from '@app/sdk';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { runLeavingFailuresAsRaised } from '../../../common/persistence/store-failure';
import { Clock } from '../../../common/services/clock';
import { NativeAuthorizeService } from '../../../session/native/authorize/native-authorize.service';
import { NATIVE_ATTEMPT_PHASE } from '../constants/native-attempt';
import { NativeAttemptStore } from '../stores/native-attempt.store';
import type { NativeAttempt } from '../types/native-attempt';
import { decryptCodeReply, encryptCodeReply } from '../utils/native-code-reply';
import {
  NativeAttemptService,
  guardOf,
  operationGuardOf,
} from './native-attempt.service';

@Injectable()
export class NativeConsentService {
  constructor(
    private readonly attempts: NativeAttemptStore,
    private readonly attemptService: NativeAttemptService,
    private readonly authorize: NativeAuthorizeService,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
  ) {}

  async consent(attemptId: string, secret: string): Promise<NativeAttemptView> {
    const current = await this.attemptService.authenticate(attemptId, secret);
    if (current.phase === NATIVE_ATTEMPT_PHASE.CODE_READY)
      return this.replay(current, secret);
    if (
      current.phase !== NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED ||
      !current.details.verifiedAccount
    ) {
      throw wrongStage();
    }
    const completed = await runLeavingFailuresAsRaised(
      this.runner,
      async (unitOfWork) => {
        const claimed = await this.attempts.claimIn(
          unitOfWork,
          guardOf(current),
          randomUUID(),
        );
        if (
          !claimed ||
          claimed.phase !== NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED ||
          !claimed.details.verifiedAccount
        ) {
          throw wrongStage();
        }
        const approved = await this.authorize.approveVerifiedIn(
          unitOfWork,
          claimed,
          claimed.details.verifiedAccount,
        );
        const reply = encryptCodeReply(
          claimed,
          secret,
          approved.redirectUri,
          approved.expiresAt,
        );
        const result = await this.attempts.transitionIn(
          unitOfWork,
          operationGuardOf(claimed),
          {
            phase: NATIVE_ATTEMPT_PHASE.CODE_READY,
            expiresAt: claimed.expiresAt,
            details: { ...claimed.details, codeReply: reply },
          },
        );
        if (!result) throw wrongStage();
        return { result, redirectUri: approved.redirectUri };
      },
    );
    return this.codeReady(completed.result, completed.redirectUri);
  }

  async resume(attemptId: string, secret: string): Promise<NativeAttemptView> {
    const attempt = await this.attemptService.authenticate(attemptId, secret);
    if (attempt.phase === NATIVE_ATTEMPT_PHASE.CODE_READY)
      return this.replay(attempt, secret);
    if (attempt.activeOperationId) throw wrongStage();
    return this.attemptService.view(attempt);
  }

  private async replay(
    attempt: NativeAttempt,
    secret: string,
  ): Promise<NativeAttemptView> {
    const principal = attempt.details.verifiedAccount;
    const reply = attempt.details.codeReply;
    if (
      !principal ||
      !reply ||
      reply.expiresAt.getTime() <= this.clock.now().getTime()
    ) {
      throw new AppException(
        ErrorCode.NATIVE_TRANSACTION_EXPIRED,
        'Native code expired',
        HttpStatus.GONE,
      );
    }
    await runLeavingFailuresAsRaised(this.runner, (unitOfWork) =>
      this.authorize.assertVerifiedCurrentIn(unitOfWork, attempt, principal),
    );
    let redirectUri: string;
    try {
      redirectUri = decryptCodeReply(attempt, secret);
    } catch {
      throw wrongStage();
    }
    return this.codeReady(attempt, redirectUri);
  }

  private codeReady(
    attempt: NativeAttempt,
    redirectUri: string,
  ): NativeAttemptView {
    return {
      attemptId: attempt.attemptId,
      expiresAt: attempt.expiresAt.toISOString(),
      stage: 'codeReady',
      redirectUri,
      activationCompleted: attempt.details.activationCompleted,
    };
  }
}

function wrongStage(): AppException {
  return new AppException(
    ErrorCode.CONFLICT,
    'Native attempt state changed',
    HttpStatus.CONFLICT,
  );
}

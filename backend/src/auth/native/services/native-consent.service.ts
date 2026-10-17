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
import { NativeAttemptCompletionService } from './native-attempt-completion.service';
import { EventRecorder } from '../../contracts/event-recorder';
import { nativeAudienceRefusal } from '../utils/native-audience-refusal';
import { expiredTransaction } from '../../../session/native/authorize/native-authorization-result';
import { NativeAttemptService, guardOf } from './native-attempt.service';

@Injectable()
export class NativeConsentService {
  constructor(
    private readonly attempts: NativeAttemptStore,
    private readonly attemptService: NativeAttemptService,
    private readonly authorize: NativeAuthorizeService,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
    private readonly completion: NativeAttemptCompletionService,
    private readonly events: EventRecorder,
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
    try {
      const completed = await runLeavingFailuresAsRaised(
        this.runner,
        async (work) => {
          const claimed = await this.attempts.claimIn(
            work,
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
          return this.completion.sealCodeIn(work, claimed, secret);
        },
      );
      return this.completion.codeReadyView(completed, secret);
    } catch (error) {
      const refusal = await nativeAudienceRefusal(
        error,
        this.events,
        current.clientId,
        expiredTransaction,
        current.details.verifiedAccount.userId,
      );
      throw refusal ?? error;
    }
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
    try {
      await runLeavingFailuresAsRaised(this.runner, (work) =>
        this.authorize.assertVerifiedCurrentIn(work, attempt, principal),
      );
      return this.completion.codeReadyView(attempt, secret);
    } catch (error) {
      const refusal = await nativeAudienceRefusal(
        error,
        this.events,
        attempt.clientId,
        expiredTransaction,
        principal.userId,
      );
      throw refusal ?? error;
    }
  }
}

function wrongStage(): AppException {
  return new AppException(
    ErrorCode.CONFLICT,
    'Native attempt state changed',
    HttpStatus.CONFLICT,
  );
}

import { Injectable } from '@nestjs/common';
import { HashService } from '../../../common/services/hash.service';
import { Clock } from '../../../common/services/clock';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { storeFailureCause } from '../../../common/persistence/store-failure';
import { isUnknownTransactionOutcome } from '../../../common/exceptions/unknown-transaction-outcome.error';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import { SecurityNoticeService } from '../../../user/services/security-notice.service';
import { SECURITY_NOTICE } from '../../../user/constants/security-notice.constants';
import { AuthService } from '../../auth.service';
import { PasswordResetCodeService } from '../../services/codes/password-reset-code.service';
import { PasswordSignInStore } from '../../stores/password-sign-in.store';
import { Sessions } from '../../services/sessions/sessions';
import { NativeAttemptStore } from '../stores/native-attempt.store';
import {
  NATIVE_ATTEMPT_FLOW,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import type { NativeAttempt } from '../types/native-attempt';
import {
  NativeAttemptService,
  operationGuardOf,
} from '../services/native-attempt.service';
import { NativeMethodsService } from '../services/native-methods.service';
import { wrongStage } from '../utils/native-attempt-errors';
import {
  hashPendingCodeGeneration,
  matchesPendingCodeGeneration,
} from '../../utils/pending-code-generation.util';
import {
  NATIVE_LIFECYCLE_CAPABILITY,
  NATIVE_LIFECYCLE_REQUEST_PHASES,
  requireLifecycleAttempt,
} from './native-lifecycle-guards';

@Injectable()
export class NativeRecoveryService {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly attemptStore: NativeAttemptStore,
    private readonly methods: NativeMethodsService,
    private readonly auth: AuthService,
    private readonly resetCodes: PasswordResetCodeService,
    private readonly accounts: PasswordSignInStore,
    private readonly profiles: AccountProfileStore,
    private readonly sessions: Sessions,
    private readonly hashService: HashService,
    private readonly notices: SecurityNoticeService,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
  ) {}

  async request(attemptId: string, secret: string, email: string) {
    const attempt = await requireLifecycleAttempt(
      this.attempts,
      this.methods,
      attemptId,
      secret,
      NATIVE_ATTEMPT_FLOW.RECOVERY,
      [...NATIVE_LIFECYCLE_REQUEST_PHASES.RECOVERY],
      NATIVE_LIFECYCLE_CAPABILITY.RECOVERY,
    );
    const claimed = await this.attempts.claim(attemptId, secret, attempt.phase);
    let stateCommitted = false;
    try {
      const generationHash = await this.auth.forgotPasswordForNative(email);
      const next = await this.attempts.transition(
        claimed,
        NATIVE_ATTEMPT_PHASE.RECOVERY_CODE_REQUIRED,
        {
          ...claimed.details,
          email: {
            address: email,
            generation: null,
            requestedAt: this.clock.now(),
          },
          emailTokenHash: null,
          emailCodeGenerationHash: generationHash,
        },
      );
      stateCommitted = true;
      return this.attempts.view(next);
    } catch (error) {
      if (!stateCommitted) await this.attempts.release(claimed);
      throw error;
    }
  }

  async confirm(
    attemptId: string,
    secret: string,
    input: { email: string; code: string; newPassword: string },
  ) {
    const attempt = await requireLifecycleAttempt(
      this.attempts,
      this.methods,
      attemptId,
      secret,
      NATIVE_ATTEMPT_FLOW.RECOVERY,
      [NATIVE_ATTEMPT_PHASE.RECOVERY_CODE_REQUIRED],
      NATIVE_LIFECYCLE_CAPABILITY.RECOVERY,
    );
    if (attempt.details.email?.address !== input.email) {
      throw this.resetCodes.invalidCode();
    }
    const reserved = await this.resetCodes.verifyPasswordReset(
      input.email,
      input.code,
    );
    if (
      !matchesPendingCodeGeneration(
        attempt.details.emailCodeGenerationHash,
        hashPendingCodeGeneration(reserved.hashedCode),
      )
    ) {
      throw this.resetCodes.invalidCode();
    }
    const account = await this.accounts.findActiveByAddress(input.email);
    if (!account) throw this.resetCodes.invalidCode();
    const passwordHash = await this.hashService.hash(input.newPassword);
    let completed: NativeAttempt;
    try {
      completed = await this.runner.run((unitOfWork) =>
        this.confirmIn(
          unitOfWork,
          attemptId,
          secret,
          input.email,
          reserved,
          passwordHash,
          account.id,
          account.sessionVersion,
        ),
      );
    } catch (error) {
      if (isUnknownTransactionOutcome(error)) {
        return this.resolveUnknownReset(
          attemptId,
          secret,
          input.email,
          account.id,
          account.sessionVersion,
          error,
        );
      }
      throw storeFailureCause(error);
    }
    this.notices.defer(account.id, SECURITY_NOTICE.PASSWORD_RESET);
    return this.attempts.view(completed);
  }

  private async confirmIn(
    unitOfWork: UnitOfWork,
    attemptId: string,
    secret: string,
    email: string,
    reserved: { id: string; hashedCode: string },
    passwordHash: string,
    userId: string,
    expectedVersion: number,
  ): Promise<NativeAttempt> {
    const claimed = await this.attempts.claimIn(
      unitOfWork,
      attemptId,
      secret,
      NATIVE_ATTEMPT_PHASE.RECOVERY_CODE_REQUIRED,
    );
    if (
      claimed.details.email?.address !== email ||
      !matchesPendingCodeGeneration(
        claimed.details.emailCodeGenerationHash,
        hashPendingCodeGeneration(reserved.hashedCode),
      )
    ) {
      throw this.resetCodes.invalidCode();
    }
    if (!(await this.resetCodes.consumePasswordResetIn(unitOfWork, reserved))) {
      throw this.resetCodes.invalidCode();
    }
    if (
      !(await this.accounts.storeNewPasswordIn(
        unitOfWork,
        userId,
        expectedVersion,
        passwordHash,
      ))
    ) {
      throw wrongStage();
    }
    const invalidated = await this.sessions.invalidateAllSessionsFromIn(
      unitOfWork,
      userId,
      expectedVersion,
    );
    if (invalidated === null) throw wrongStage();
    const transitioned = await this.attemptStore.transitionIn(
      unitOfWork,
      operationGuardOf(claimed),
      {
        phase: NATIVE_ATTEMPT_PHASE.RECOVERY_COMPLETE,
        expiresAt: claimed.expiresAt,
        details: {
          ...claimed.details,
          emailCodeGenerationHash: null,
          emailTokenHash: null,
        },
      },
    );
    if (!transitioned) throw wrongStage();
    return transitioned;
  }

  private async resolveUnknownReset(
    attemptId: string,
    secret: string,
    email: string,
    userId: string,
    expectedVersion: number,
    error: unknown,
  ) {
    try {
      const attempt = await this.attempts.authenticate(attemptId, secret);
      const account = await this.profiles.findAccount(userId);
      if (
        attempt.phase === NATIVE_ATTEMPT_PHASE.RECOVERY_COMPLETE &&
        attempt.details.email?.address === email &&
        account &&
        !account.isDeleted &&
        account.sessionVersion > expectedVersion
      ) {
        this.notices.defer(userId, SECURITY_NOTICE.PASSWORD_RESET);
        return this.attempts.view(attempt);
      }
    } catch {
      return this.unavailable(error);
    }
    return this.unavailable(error);
  }

  private unavailable(error: unknown): never {
    return asAuthorityUnavailable(error);
  }
}

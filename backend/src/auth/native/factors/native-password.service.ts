import { ErasureRefusal } from '../../../user/erasure/services/erasure-refusal';
import { Optional } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { NativeAttemptView, NativePasswordInput } from '@app/sdk';
import {
  NATIVE_FACTOR_INPUT_LIMIT,
  NATIVE_FACTOR_INPUT_PATTERN,
} from './constants/native-factor-input';
import { HashService } from '../../../common/services/hash.service';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { runLeavingFailuresAsRaised } from '../../../common/persistence/store-failure';
import { PasswordSignInStore } from '../../stores/password-sign-in.store';
import {
  invalidCredentials,
  verifyPasswordCredentials,
} from '../../services/password/password-credentials';
import { NativeAttemptService } from '../services/native-attempt.service';
import { EventRecorder } from '../../contracts/event-recorder';
import { nativeAudienceRefusal } from '../utils/native-audience-refusal';
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

@Injectable()
export class NativePasswordService {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly methods: NativeMethodsService,
    private readonly accounts: PasswordSignInStore,
    private readonly hashes: HashService,
    private readonly runner: UnitOfWorkRunner,
    private readonly events: EventRecorder,
    @Optional() private readonly erasure?: ErasureRefusal,
  ) {}

  async password(
    attemptId: string,
    secret: string,
    input: NativePasswordInput,
  ): Promise<NativeAttemptView> {
    if (
      !input ||
      Object.keys(input).some((key) => !['email', 'password'].includes(key)) ||
      typeof input.email !== 'string' ||
      typeof input.password !== 'string' ||
      !NATIVE_FACTOR_INPUT_PATTERN.EMAIL.test(input.email) ||
      input.email.length > NATIVE_FACTOR_INPUT_LIMIT.EMAIL ||
      input.password.length === 0 ||
      Buffer.byteLength(input.password, 'utf8') >
        NATIVE_FACTOR_INPUT_LIMIT.PASSWORD_BYTES
    )
      throw invalidRequest();
    const claimed = await this.attempts.claim(
      attemptId,
      secret,
      NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
    );
    let targetUserId: string | undefined;
    try {
      if (claimed.flow !== NATIVE_ATTEMPT_FLOW.SIGN_IN) throw wrongStage();
      const methods = await this.methods.forClient(claimed.clientId);
      if (!methods.capabilities.password) throw featureDisabled();
      const user = await verifyPasswordCredentials(this.accounts, this.hashes, {
        ...input,
        refuseDeactivated: async (userId, failure) =>
          this.erasure?.refusalFor(userId, failure) ?? failure,
      });
      targetUserId = user.id;
      const completed = await runLeavingFailuresAsRaised(this.runner, (work) =>
        this.attempts.completeFactorIn(
          work,
          claimed,
          {
            userId: user.id,
            userVersion: user.sessionVersion,
            firstFactor: NATIVE_ATTEMPT_FIRST_FACTOR.PASSWORD,
            authenticationMethods: ['pwd'],
          },
          secret,
        ),
      );
      return this.attempts.viewAfter(completed, secret);
    } catch (error) {
      await this.attempts.release(claimed).catch(() => undefined);
      const refusal = await nativeAudienceRefusal(
        error,
        this.events,
        claimed.clientId,
        invalidCredentials,
        targetUserId,
      );
      throw refusal ?? error;
    }
  }
}

import { Injectable } from '@nestjs/common';
import type { NativeAttemptView, NativePasswordInput } from '@app/sdk';
import { HashService } from '../../../common/services/hash.service';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { runLeavingFailuresAsRaised } from '../../../common/persistence/store-failure';
import { PasswordSignInStore } from '../../stores/password-sign-in.store';
import { verifyPasswordCredentials } from '../../services/password/password-credentials';
import { NativeAttemptService } from '../services/native-attempt.service';
import { NativeMethodsService } from '../services/native-methods.service';
import {
  NATIVE_ATTEMPT_FIRST_FACTOR,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import {
  featureDisabled,
  invalidRequest,
} from '../utils/native-attempt-errors';

@Injectable()
export class NativePasswordService {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly methods: NativeMethodsService,
    private readonly accounts: PasswordSignInStore,
    private readonly hashes: HashService,
    private readonly runner: UnitOfWorkRunner,
  ) {}

  async password(
    attemptId: string,
    secret: string,
    input: NativePasswordInput,
  ): Promise<NativeAttemptView> {
    if (
      !input ||
      typeof input.email !== 'string' ||
      typeof input.password !== 'string' ||
      input.email.length > 320 ||
      input.password.length > 1024
    )
      throw invalidRequest();
    const claimed = await this.attempts.claim(
      attemptId,
      secret,
      NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
    );
    try {
      const methods = await this.methods.forClient(claimed.clientId);
      if (!methods.capabilities.password) throw featureDisabled();
      const user = await verifyPasswordCredentials(
        this.accounts,
        this.hashes,
        input,
      );
      const completed = await runLeavingFailuresAsRaised(this.runner, (work) =>
        this.attempts.completeFactorIn(work, claimed, {
          userId: user.id,
          userVersion: user.sessionVersion,
          firstFactor: NATIVE_ATTEMPT_FIRST_FACTOR.PASSWORD,
          authenticationMethods: ['pwd'],
        }),
      );
      return this.attempts.view(completed);
    } catch (error) {
      await this.attempts.release(claimed).catch(() => undefined);
      throw error;
    }
  }
}

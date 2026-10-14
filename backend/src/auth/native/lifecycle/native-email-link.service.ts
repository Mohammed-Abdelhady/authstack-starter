import { Injectable } from '@nestjs/common';
import type { SupportedLocale } from '../../../common/constants/locales';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { storeFailureCause } from '../../../common/persistence/store-failure';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { isUnknownTransactionOutcome } from '../../../common/exceptions/unknown-transaction-outcome.error';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import { Clock } from '../../../common/services/clock';
import { NativeEmailLinkMailService } from './native-email-link-mail.service'; // feature:magic-link
import { MAGIC_LINK_ACCOUNT_CONSTRAINT } from '../../magic-link/stores/magic-link-accounts';
import {
  hashMagicLinkToken,
  sameHash,
} from '../../magic-link/utils/magic-link-token.util';
import {
  NATIVE_ATTEMPT_FIRST_FACTOR,
  NATIVE_ATTEMPT_FLOW,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import type { NativeAttempt } from '../types/native-attempt';
import { NativeAttemptService } from '../services/native-attempt.service';
import { NativeMethodsService } from '../services/native-methods.service';
import { wrongStage } from '../utils/native-attempt-errors';
import {
  requireLifecycleAttempt,
  NATIVE_LIFECYCLE_CAPABILITY,
  NATIVE_LIFECYCLE_REQUEST_PHASES,
} from './native-lifecycle-guards';

const EMAIL_LINK_RETRY_LIMIT = 2;

@Injectable()
export class NativeEmailLinkService {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly methods: NativeMethodsService,
    private readonly links: NativeEmailLinkMailService,
    private readonly accounts: AccountProfileStore,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
  ) {}

  async request(
    attemptId: string,
    secret: string,
    email: string,
    locale: SupportedLocale,
  ) {
    const attempt = await requireLifecycleAttempt(
      this.attempts,
      this.methods,
      attemptId,
      secret,
      NATIVE_ATTEMPT_FLOW.SIGN_IN,
      [...NATIVE_LIFECYCLE_REQUEST_PHASES.EMAIL_LINK],
      NATIVE_LIFECYCLE_CAPABILITY.EMAIL_LINK,
    );
    const claimed = await this.attempts.claim(attemptId, secret, attempt.phase);
    let stored = false;
    try {
      await this.links.request(
        { email, locale },
        attempt.redirectUri,
        attempt.attemptId,
        attempt.state,
        attempt.expiresAt,
        async (tokenHash) => {
          await this.attempts.transition(
            claimed,
            NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT,
            {
              ...claimed.details,
              email: {
                address: email,
                generation: null,
                requestedAt: this.clock.now(),
              },
              emailTokenHash: tokenHash,
              emailCodeGenerationHash: null,
            },
          );
          stored = true;
        },
      );
    } catch (error) {
      if (!stored) await this.attempts.release(claimed);
      throw error;
    }
    return this.attempts.view(
      await this.attempts.authenticate(attemptId, secret),
    );
  }

  async verify(
    attemptId: string,
    secret: string,
    input: { token: string; state: string; locale: SupportedLocale },
  ) {
    const attempt = await requireLifecycleAttempt(
      this.attempts,
      this.methods,
      attemptId,
      secret,
      NATIVE_ATTEMPT_FLOW.SIGN_IN,
      [NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT],
      NATIVE_LIFECYCLE_CAPABILITY.EMAIL_LINK,
    );
    const tokenHash = hashMagicLinkToken(input.token);
    if (
      input.state !== attempt.state ||
      !sameHash(attempt.details.emailTokenHash ?? '', tokenHash)
    ) {
      throw this.links.invalidNativeLink();
    }
    const completed = await this.complete(
      attempt,
      attemptId,
      secret,
      tokenHash,
      input.locale,
    );
    return this.attempts.view(completed);
  }

  private async complete(
    attempt: NativeAttempt,
    attemptId: string,
    secret: string,
    tokenHash: string,
    locale: SupportedLocale,
  ): Promise<NativeAttempt> {
    const work = (unitOfWork: UnitOfWork) =>
      this.completeIn(unitOfWork, attempt, attemptId, secret, {
        tokenHash,
        locale,
      });
    for (let pass = 0; pass < EMAIL_LINK_RETRY_LIMIT; pass += 1) {
      try {
        return await this.runner.run(work);
      } catch (error) {
        if (
          !this.isAddressConflict(error) ||
          pass + 1 === EMAIL_LINK_RETRY_LIMIT
        ) {
          if (isUnknownTransactionOutcome(error)) asAuthorityUnavailable(error);
          throw storeFailureCause(error);
        }
      }
    }
    throw wrongStage();
  }

  private async completeIn(
    unitOfWork: UnitOfWork,
    expected: NativeAttempt,
    attemptId: string,
    secret: string,
    proof: { tokenHash: string; locale: SupportedLocale },
  ): Promise<NativeAttempt> {
    const { tokenHash, locale } = proof;
    const claimed = await this.attempts.claimIn(
      unitOfWork,
      attemptId,
      secret,
      NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT,
    );
    const email = claimed.details.email?.address;
    if (
      !email ||
      email !== expected.details.email?.address ||
      !sameHash(claimed.details.emailTokenHash ?? '', tokenHash)
    ) {
      throw wrongStage();
    }
    const linkAccount = await this.links.resolveAccountIn(
      unitOfWork,
      email,
      locale,
    );
    const account = await this.accounts.readAccount(unitOfWork, linkAccount.id);
    if (!account || account.isDeleted || account.email !== email) {
      throw this.links.invalidNativeLink();
    }
    return this.attempts.completeFactorIn(
      unitOfWork,
      {
        ...claimed,
        details: {
          ...claimed.details,
          emailTokenHash: null,
          emailCodeGenerationHash: null,
        },
      },
      {
        userId: account.id,
        userVersion: account.sessionVersion,
        firstFactor: NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_LINK,
        authenticationMethods: [NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_LINK],
      },
    );
  }

  private isAddressConflict(error: unknown): boolean {
    return (
      error instanceof UniqueConflictError &&
      error.constraint === MAGIC_LINK_ACCOUNT_CONSTRAINT.ADDRESS
    );
  }
}

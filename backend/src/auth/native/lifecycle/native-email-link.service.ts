import { Injectable } from '@nestjs/common';
import { AddressReservationTakenError } from '../../../common/persistence/address-reservation-taken.error';
import type { SupportedLocale } from '../../../common/constants/locales';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { storeFailureCause } from '../../../common/persistence/store-failure';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { AppException } from '../../../common/exceptions/app.exception';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import type { AccountCreationMethod } from '../../types/account-creation';
import { isUnknownTransactionOutcome } from '../../../common/exceptions/unknown-transaction-outcome.error';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import { EventRecorder } from '../../contracts/event-recorder';
import { SelfSignUpRefusedError } from '../../services/registration/self-sign-up-refused.error';
import { SessionIssuanceService } from '../../../session/services/session-issuance.service';
import { nativeAudienceRefusal } from '../utils/native-audience-refusal';
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

/** A mailed proof of the attempt's address: the link token, or the emailed code. */
export interface NativeEmailProof {
  firstFactor:
    | typeof NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_LINK
    | typeof NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_CODE;
  /** Throws when the proof no longer holds for the claimed attempt. */
  spendIn: (unitOfWork: UnitOfWork, claimed: NativeAttempt) => Promise<void>;
  refuse: () => AppException;
  /** Answers a deactivated account once the proof held. Absent, `refuse` does. */
  refuseDeactivated?: () => AppException;
  creationMethod: AccountCreationMethod;
}

@Injectable()
export class NativeEmailLinkService {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly methods: NativeMethodsService,
    private readonly links: NativeEmailLinkMailService,
    private readonly accounts: AccountProfileStore,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
    private readonly events: EventRecorder,
    private readonly issuance: SessionIssuanceService,
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
        attempt.clientId,
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
    const completed = await this.completeWithProof(
      attempt,
      attemptId,
      secret,
      input.locale,
      {
        firstFactor: NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_LINK,
        spendIn: (_unitOfWork, claimed) => {
          if (!sameHash(claimed.details.emailTokenHash ?? '', tokenHash)) {
            throw wrongStage();
          }
          return Promise.resolve();
        },
        refuse: () => this.links.invalidNativeLink(),
        creationMethod: ACCOUNT_CREATION_METHOD.MAGIC_LINK,
      },
    );
    return this.attempts.viewAfter(completed, secret);
  }

  /** Finishes a mailed first factor. The proof is spent inside the same unit of work. */
  async completeWithProof(
    attempt: NativeAttempt,
    attemptId: string,
    secret: string,
    locale: SupportedLocale,
    proof: NativeEmailProof,
  ): Promise<NativeAttempt> {
    const refusalContext: { targetUserId?: string } = {};
    const work = (unitOfWork: UnitOfWork) =>
      this.completeIn(unitOfWork, attempt, attemptId, secret, {
        proof,
        locale,
        refusalContext,
      });
    for (let pass = 0; pass < EMAIL_LINK_RETRY_LIMIT; pass += 1) {
      try {
        return await this.runner.run(work);
      } catch (error) {
        const refusal = await nativeAudienceRefusal(
          error,
          this.events,
          attempt.clientId,
          proof.refuse,
          refusalContext.targetUserId,
        );
        if (refusal) throw refusal;
        if (storeFailureCause(error) instanceof SelfSignUpRefusedError) {
          await this.issuance.recordCreationRefusal(
            attempt.clientId,
            proof.creationMethod,
          );
          throw proof.refuse();
        }
        if (error instanceof AddressReservationTakenError) {
          const owner = await this.links.hasAccountAtAddress(
            attempt.details.email?.address ?? '',
          );
          if (!owner) throw proof.refuse();
        }
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
    spending: {
      proof: NativeEmailProof;
      locale: SupportedLocale;
      refusalContext: { targetUserId?: string };
    },
  ): Promise<NativeAttempt> {
    const { proof, locale } = spending;
    const claimed = await this.attempts.claimIn(
      unitOfWork,
      attemptId,
      secret,
      NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT,
    );
    const email = claimed.details.email?.address;
    if (!email || email !== expected.details.email?.address) {
      throw wrongStage();
    }
    await proof.spendIn(unitOfWork, claimed);
    const refuseDeactivated = proof.refuseDeactivated ?? proof.refuse;
    const linkAccount = await this.links.resolveAccountIn(
      unitOfWork,
      email,
      locale,
      claimed.clientId,
      proof.refuse,
      proof.creationMethod,
      refuseDeactivated,
    );
    const account = await this.accounts.readAccount(unitOfWork, linkAccount.id);
    if (account?.isDeleted) throw refuseDeactivated();
    if (!account || account.email !== email) throw proof.refuse();
    spending.refusalContext.targetUserId = account.id;
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
        firstFactor: proof.firstFactor,
        authenticationMethods: [proof.firstFactor],
      },
      secret,
    );
  }

  private isAddressConflict(error: unknown): boolean {
    return (
      error instanceof UniqueConflictError &&
      error.constraint === MAGIC_LINK_ACCOUNT_CONSTRAINT.ADDRESS
    );
  }
}

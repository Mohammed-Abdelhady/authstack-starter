import { Injectable } from '@nestjs/common';
import { AddressLedger } from '../../../common/persistence/address-ledger';
import type { SupportedLocale } from '../../../common/constants/locales';
import { HashService } from '../../../common/services/hash.service';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { storeFailureCause } from '../../../common/persistence/store-failure';
import { isUnknownTransactionOutcome } from '../../../common/exceptions/unknown-transaction-outcome.error';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import { RegistrationService } from '../../services/registration/registration.service';
import { VerificationCodeService } from '../../services/codes/verification-code.service';
import { ActivationAccounts } from '../../pending-codes/activation-accounts';
import { PENDING_PURPOSE } from '../../constants/registration';
import { activationCodeInvalid } from '../../utils/activation-error.util';
import { createActivatedAccount } from '../../utils/activation.util';
import { AccountCreationPolicy } from '../../services/registration/account-creation-policy';
import {
  hashPendingCodeGeneration,
  matchesPendingCodeGeneration,
} from '../../utils/pending-code-generation.util';
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
  NATIVE_LIFECYCLE_CAPABILITY,
  NATIVE_LIFECYCLE_REQUEST_PHASES,
  requireLifecycleAttempt,
} from './native-lifecycle-guards';

/** What activation takes, with the language the account stores. */
interface NativeActivationInput {
  email: string;
  code: string;
  password: string;
  name: string;
  locale: SupportedLocale;
}

@Injectable()
export class NativeRegistrationService {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly methods: NativeMethodsService,
    private readonly registration: RegistrationService,
    private readonly codes: VerificationCodeService,
    private readonly activationAccounts: ActivationAccounts,
    private readonly accounts: AccountProfileStore,
    private readonly hashService: HashService,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
    private readonly policy: AccountCreationPolicy,
    private readonly ledger: AddressLedger,
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
      NATIVE_ATTEMPT_FLOW.REGISTRATION,
      [...NATIVE_LIFECYCLE_REQUEST_PHASES.REGISTRATION],
      NATIVE_LIFECYCLE_CAPABILITY.REGISTRATION,
    );
    const claimed = await this.attempts.claim(attemptId, secret, attempt.phase);
    let stateCommitted = false;
    try {
      const generationHash = await this.registration.registerForNative(
        email,
        locale,
        claimed.clientId,
      );
      const next = await this.attempts.transition(
        claimed,
        NATIVE_ATTEMPT_PHASE.REGISTRATION_CODE_REQUIRED,
        {
          ...claimed.details,
          email: {
            address: email,
            generation: null,
            requestedAt: this.clock.now(),
          },
          emailTokenHash: null,
          emailCodeGenerationHash: generationHash,
          activationCompleted: false,
        },
      );
      stateCommitted = true;
      return this.attempts.view(next);
    } catch (error) {
      if (!stateCommitted) await this.attempts.release(claimed);
      throw error;
    }
  }

  async activate(
    attemptId: string,
    secret: string,
    input: NativeActivationInput,
  ) {
    const attempt = await requireLifecycleAttempt(
      this.attempts,
      this.methods,
      attemptId,
      secret,
      NATIVE_ATTEMPT_FLOW.REGISTRATION,
      [NATIVE_ATTEMPT_PHASE.REGISTRATION_CODE_REQUIRED],
      NATIVE_LIFECYCLE_CAPABILITY.REGISTRATION,
    );
    if (attempt.details.email?.address !== input.email)
      throw activationCodeInvalid();
    const reserved = await this.codes.verifyCode(
      input.email,
      input.code,
      PENDING_PURPOSE.SIGNUP,
    );
    if (
      !matchesPendingCodeGeneration(
        attempt.details.emailCodeGenerationHash,
        hashPendingCodeGeneration(reserved.hashedCode),
      )
    ) {
      throw activationCodeInvalid();
    }
    const passwordHash = await this.hashService.hash(input.password);
    const accountId = this.activationAccounts.newAccountId();
    try {
      const completed = await this.runner.run((unitOfWork) =>
        this.activateIn(
          unitOfWork,
          attempt,
          attemptId,
          secret,
          input,
          reserved,
          passwordHash,
          accountId,
        ),
      );
      return this.attempts.view(completed);
    } catch (error) {
      if (isUnknownTransactionOutcome(error)) {
        return this.resolveUnknownActivation(
          attemptId,
          secret,
          accountId,
          error,
        );
      }
      throw storeFailureCause(error);
    }
  }

  private async activateIn(
    unitOfWork: UnitOfWork,
    expected: NativeAttempt,
    attemptId: string,
    secret: string,
    input: NativeActivationInput,
    reserved: Awaited<ReturnType<VerificationCodeService['verifyCode']>>,
    passwordHash: string,
    accountId: string,
  ): Promise<NativeAttempt> {
    const claimed = await this.attempts.claimIn(
      unitOfWork,
      attemptId,
      secret,
      NATIVE_ATTEMPT_PHASE.REGISTRATION_CODE_REQUIRED,
    );
    if (
      claimed.details.email?.address !== expected.details.email?.address ||
      !matchesPendingCodeGeneration(
        claimed.details.emailCodeGenerationHash,
        hashPendingCodeGeneration(reserved.hashedCode),
      )
    ) {
      throw activationCodeInvalid();
    }
    if (!(await this.codes.consumeCode(reserved, unitOfWork))) {
      throw activationCodeInvalid();
    }
    const account = await createActivatedAccount(
      this.activationAccounts,
      unitOfWork,
      reserved,
      { id: accountId, passwordHash, name: input.name, locale: input.locale },
      this.policy,
      claimed.clientId,
      this.ledger,
      this.clock.now(),
    );
    const storedAccount = await this.accounts.readAccount(
      unitOfWork,
      account.id,
    );
    if (
      !storedAccount ||
      storedAccount.isDeleted ||
      storedAccount.email !== input.email
    ) {
      throw wrongStage();
    }
    const activationClaimed: NativeAttempt = {
      ...claimed,
      details: {
        ...claimed.details,
        activationCompleted: true,
        emailCodeGenerationHash: null,
      },
    };
    return this.attempts.completeFactorIn(unitOfWork, activationClaimed, {
      userId: storedAccount.id,
      userVersion: storedAccount.sessionVersion,
      firstFactor: NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_CODE,
      authenticationMethods: [NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_CODE],
    });
  }

  private async resolveUnknownActivation(
    attemptId: string,
    secret: string,
    accountId: string,
    error: unknown,
  ) {
    try {
      const attempt = await this.attempts.authenticate(attemptId, secret);
      const storedAccount = await this.accounts.findAccount(accountId);
      if (
        storedAccount &&
        !storedAccount.isDeleted &&
        storedAccount.email === attempt.details.email?.address &&
        attempt.details.activationCompleted === true &&
        attempt.details.verifiedAccount?.userId === accountId
      ) {
        return this.attempts.view(attempt);
      }
    } catch {
      return asAuthorityUnavailable(error);
    }
    return asAuthorityUnavailable(error);
  }
}

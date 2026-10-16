import { Injectable } from '@nestjs/common';
import type { NativeAttemptView, NativeSecondFactorInput } from '@app/sdk';
import { NATIVE_FACTOR_INPUT_PATTERN } from './constants/native-factor-input';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { runLeavingFailuresAsRaised } from '../../../common/persistence/store-failure';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { SecondFactorStore } from '../../two-factor/stores/second-factor.store';
import { TwoFactorVerificationService } from '../../two-factor/services/two-factor-verification.service';
import { NativeAttemptService } from '../services/native-attempt.service';
import { NativeAttemptCompletionService } from '../services/native-attempt-completion.service';
import { EventRecorder } from '../../contracts/event-recorder';
import { nativeAudienceRefusal } from '../utils/native-audience-refusal';
import { NATIVE_ATTEMPT_PHASE } from '../constants/native-attempt';
import {
  featureDisabled,
  invalidRequest,
  wrongStage,
} from '../utils/native-attempt-errors';
import { assertNativePolicy } from '../utils/native-policy.util';
import { NativeMethodsService } from '../services/native-methods.service';
import { NativePasskeyService } from './native-passkey.service'; // feature:passkeys

@Injectable()
export class NativeSecondFactorService {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly completion: NativeAttemptCompletionService,
    private readonly events: EventRecorder,
    private readonly factors: SecondFactorStore,
    private readonly verification: TwoFactorVerificationService,
    private readonly passkeys: NativePasskeyService, // feature:passkeys
    private readonly features: AuthFeaturesService,
    private readonly runner: UnitOfWorkRunner,
    private readonly accounts: AccountProfileStore,
    private readonly methods: NativeMethodsService,
    private readonly epoch: AuthEpochService,
  ) {}

  async verify(
    attemptId: string,
    secret: string,
    input: NativeSecondFactorInput,
  ): Promise<NativeAttemptView> {
    if (!isInput(input)) throw invalidRequest();
    // feature:passkeys:start
    if ('passkeyResponse' in input && input.passkeyResponse) {
      return this.passkeys.verify(attemptId, secret, input.passkeyResponse);
    }
    // feature:passkeys:end
    if (!this.features.isEnabled(AuthFeature.TWO_FACTOR))
      throw featureDisabled();
    const claimed = await this.attempts.claim(
      attemptId,
      secret,
      NATIVE_ATTEMPT_PHASE.SECOND_FACTOR_REQUIRED,
    );
    try {
      const principal = claimed.details.verifiedAccount;
      if (!principal || !claimed.details.secondFactors?.includes('totp'))
        throw wrongStage();
      const account = await this.factors.findChallengedAccount(
        principal.userId,
      );
      if (!account || account.isDeleted || !account.twoFactor.enabled)
        throw wrongStage();
      const beforeReservation = await this.accounts.findProfile(
        principal.userId,
      );
      if (
        !beforeReservation ||
        beforeReservation.isDeleted ||
        !beforeReservation.twoFactorEnabled ||
        beforeReservation.sessionVersion !== principal.userVersion
      )
        throw wrongStage();
      const verify = await this.verification.prepareNativeSecondFactor(
        account,
        input,
        principal.userVersion,
      );
      const completed = await runLeavingFailuresAsRaised(
        this.runner,
        async (work) => {
          assertNativePolicy(
            claimed,
            this.methods.policyHash(claimed.clientId),
            this.epoch.current(),
          );
          const current = await this.accounts.readAccount(
            work,
            principal.userId,
          );
          if (
            !current ||
            current.isDeleted ||
            !current.twoFactorEnabled ||
            current.sessionVersion !== principal.userVersion
          )
            throw wrongStage();
          await verify(work);
          return this.completion.afterLastFactorIn(work, claimed, {
            method: 'code' in input ? 'otp' : 'recovery',
            userVerified: false,
            secret,
          });
        },
      );
      return this.attempts.viewAfter(completed, secret);
    } catch (error) {
      await this.attempts.release(claimed).catch(() => undefined);
      const refusal = await nativeAudienceRefusal(
        error,
        this.events,
        claimed.clientId,
        () => this.verification.invalidCode('account audience is not admitted'),
        claimed.details.verifiedAccount?.userId,
      );
      throw refusal ?? error;
    }
  }
}

function isInput(input: unknown): input is NativeSecondFactorInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  const names = Object.keys(record);
  if (names.length !== 1) return false;
  const name = names[0];
  if (name === 'code')
    return (
      typeof record.code === 'string' &&
      NATIVE_FACTOR_INPUT_PATTERN.CODE.test(record.code)
    );
  if (name === 'recoveryCode')
    return (
      typeof record.recoveryCode === 'string' &&
      NATIVE_FACTOR_INPUT_PATTERN.RECOVERY_CODE.test(record.recoveryCode)
    );
  // feature:passkeys:start
  if (name === 'passkeyResponse')
    return (
      typeof record.passkeyResponse === 'object' &&
      record.passkeyResponse !== null
    );
  // feature:passkeys:end
  return false;
}

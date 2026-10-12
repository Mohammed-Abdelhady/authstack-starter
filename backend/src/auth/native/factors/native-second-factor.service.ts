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
import { NativeAttemptStore } from '../stores/native-attempt.store';
import {
  NativeAttemptService,
  operationGuardOf,
} from '../services/native-attempt.service';
import { NATIVE_ATTEMPT_PHASE } from '../constants/native-attempt';
import {
  featureDisabled,
  invalidRequest,
  wrongStage,
} from '../utils/native-attempt-errors';
import { assertNativePolicy } from '../utils/native-policy.util';
import { NativeMethodsService } from '../services/native-methods.service';
import { NativePasskeyService } from './native-passkey.service';

@Injectable()
export class NativeSecondFactorService {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly stores: NativeAttemptStore,
    private readonly factors: SecondFactorStore,
    private readonly verification: TwoFactorVerificationService,
    private readonly passkeys: NativePasskeyService,
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
    if ('passkeyResponse' in input && input.passkeyResponse) {
      return this.passkeys.verify(attemptId, secret, input.passkeyResponse);
    }
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
      const verify = await this.verification.prepareNativeSecondFactor(
        account,
        input,
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
          const result = await this.stores.transitionIn(
            work,
            operationGuardOf(claimed),
            {
              phase: NATIVE_ATTEMPT_PHASE.CONSENT_REQUIRED,
              expiresAt: claimed.expiresAt,
              details: {
                ...claimed.details,
                secondFactors: undefined,
                passkeyChallengeHash: null,
                passkeyPurpose: null,
                verifiedAccount: {
                  ...principal,
                  authenticationMethods: [
                    ...principal.authenticationMethods,
                    'code' in input ? 'otp' : 'recovery',
                  ],
                },
              },
            },
          );
          if (!result) throw wrongStage();
          return result;
        },
      );
      return this.attempts.view(completed);
    } catch (error) {
      await this.attempts.release(claimed).catch(() => undefined);
      throw error;
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
  return (
    name === 'passkeyResponse' &&
    typeof record.passkeyResponse === 'object' &&
    record.passkeyResponse !== null
  );
}

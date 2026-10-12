import { Injectable } from '@nestjs/common';
import { HashService } from '../../../common/services/hash.service';
import { AuthFeature } from '../../enums/auth-feature.enum'; // feature:totp
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import {
  REAUTH_REQUIREMENT, // feature:totp
  reauthRequired, // feature:totp
  ReauthMessages,
  ReauthService,
  SessionAge,
} from '../../services/reauth/reauth.service';
import { TwoFactorVerificationService } from '../../two-factor/services/two-factor-verification.service'; // feature:totp
import { SecondFactorStore } from '../../two-factor/stores/second-factor.store'; // feature:totp
import { PasskeyRegistrationOptionsDto } from '../dto/passkey-registration-options.dto';
import { PasskeyAccounts } from '../stores/passkey-accounts';

/**
 * Who may add a passkey to an account. A passkey that verifies its user signs
 * in with nothing else, and neither a password change nor a reset removes it,
 * so a session alone is not enough to add one: whoever held it for a minute
 * would keep a way in for good.
 *
 * The first proof is the one turning two-factor on asks for: the password
 * when the account has one and password sign-in is on, otherwise a sign-in no
 * older than five minutes. An account with two-factor on answers its second
 * step again as well, with a code or a recovery code in the same request. A
 * session does not record when its factors were proved, so nothing short of a
 * fresh answer shows the second step is current.
 */
@Injectable()
export class PasskeyRegistrationReauth extends ReauthService {
  protected override readonly messages: ReauthMessages = {
    passwordRequired: 'Enter your password to add a passkey',
    recentSignInRequired: 'Sign in again to add a passkey',
  };

  constructor(
    hashService: HashService,
    features: AuthFeaturesService,
    private readonly accounts: PasskeyAccounts,
    private readonly secondFactors: SecondFactorStore, // feature:totp
    private readonly secondFactorChecks: TwoFactorVerificationService, // feature:totp
  ) {
    super(hashService, features);
  }

  /**
   * @throws AppException REAUTH_REQUIRED when a proof the account owes is
   * missing, with the missing one in `details.required`
   * @throws AppException INVALID_CURRENT_PASSWORD when the password is wrong
   * @throws AppException TWO_FACTOR_CODE_INVALID when the code is wrong
   * @throws AppException TWO_FACTOR_LOCKED while the account's codes are locked
   */
  async assertMayAddPasskey(
    userId: string,
    proof: PasskeyRegistrationOptionsDto,
    session: SessionAge | undefined,
  ): Promise<void> {
    const holder = await this.accounts.findPassword(userId);
    await this.assertReauthenticated(holder ?? {}, proof.password, session);
    await this.assertSecondStep(userId, proof); // feature:totp
  }

  // feature:totp:start
  /**
   * Checked after the first proof, so a caller without it learns nothing
   * about the second factor and cannot spend guesses against it.
   */
  private async assertSecondStep(
    userId: string,
    proof: PasskeyRegistrationOptionsDto,
  ): Promise<void> {
    if (!this.features.isEnabled(AuthFeature.TWO_FACTOR)) {
      return;
    }

    const account = await this.secondFactors.findAccount(userId);
    if (!account?.twoFactor.enabled) {
      return;
    }

    if (!proof.code && !proof.recoveryCode) {
      throw reauthRequired(
        'Enter a code from your authenticator app to add a passkey',
        REAUTH_REQUIREMENT.SECOND_FACTOR,
      );
    }

    await this.secondFactorChecks.verifySecondFactor(account, proof);
  }
  // feature:totp:end
}

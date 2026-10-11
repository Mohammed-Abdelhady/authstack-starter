import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { TotpSecretCryptoService } from './totp-secret-crypto.service';
import { checkTotpDelta } from '../utils/totp.util';
import {
  hashRecoveryCode,
  recoveryHashEquals,
} from '../utils/recovery-code.util';
import { TOTP_STEP_MS } from '../constants/two-factor.constants';
import {
  SecondFactorAccount,
  StoredTotpSecret,
} from '../stores/second-factor-account';
import {
  SecondFactorStore,
  SPEND_OUTCOME,
} from '../stores/second-factor.store';

/** What a caller may send as the second factor. Exactly one is used. */
export interface SecondFactorInput {
  code?: string;
  recoveryCode?: string;
}

/**
 * Checks a second factor and records that it was spent. Every route that asks
 * for a code goes through here, so replay protection and single-use recovery
 * codes hold everywhere and not only on the login path.
 */
@Injectable()
export class TwoFactorVerificationService {
  private readonly logger = new Logger(TwoFactorVerificationService.name);

  constructor(
    private readonly accounts: SecondFactorStore,
    private readonly cryptoService: TotpSecretCryptoService,
  ) {}

  /**
   * @throws AppException TWO_FACTOR_CODE_INVALID when neither field is filled
   * in, or when the value in it does not match
   */
  async verifySecondFactor(
    user: SecondFactorAccount,
    input: SecondFactorInput,
  ): Promise<void> {
    if (input.code) {
      await this.verifyTotpCode(user, input.code);
      return;
    }

    if (input.recoveryCode) {
      await this.verifyRecoveryCode(user, input.recoveryCode);
      return;
    }

    throw this.invalidCode('neither a code nor a recovery code was sent');
  }

  /**
   * Checks a code against the secret on the account, whether or not the second
   * factor is confirmed yet, and marks the step as spent.
   */
  async verifyTotpCode(user: SecondFactorAccount, code: string): Promise<void> {
    const secret = user.twoFactor.secret;
    if (!secret) {
      throw this.invalidCode('account has no secret to check against');
    }

    const step = await this.resolveStep(user, secret, code);
    const lastUsedStep = user.twoFactor.lastUsedStep;

    if (typeof lastUsedStep === 'number' && step <= lastUsedStep) {
      throw this.invalidCode('code was already used');
    }

    const outcome = await this.accounts.spendTotpStep(user, step);

    if (outcome !== SPEND_OUTCOME.SPENT) {
      throw this.invalidCode('code was already used');
    }
  }

  /** Spends one recovery code. A code that was already spent is refused. */
  async verifyRecoveryCode(
    user: SecondFactorAccount,
    recoveryCode: string,
  ): Promise<void> {
    const hash = hashRecoveryCode(recoveryCode);
    const match = user.twoFactor.recoveryCodes.find(
      (candidate) =>
        candidate.usedAt === null && recoveryHashEquals(candidate.hash, hash),
    );

    if (!match) {
      throw this.invalidCode('recovery code is unknown or already used');
    }

    const outcome = await this.accounts.spendRecoveryCode(
      user,
      match.hash,
      new Date(Date.now()),
    );

    if (outcome !== SPEND_OUTCOME.SPENT) {
      throw this.invalidCode('recovery code is unknown or already used');
    }
  }

  /**
   * The absolute TOTP step the code belongs to, counted from the epoch. Steps
   * only ever move forward, which is what makes a spent one detectable.
   *
   * A secret the previous key still reads is written again under the current
   * key here, so the previous key can be dropped once every account has
   * answered a code.
   */
  private async resolveStep(
    user: SecondFactorAccount,
    secret: StoredTotpSecret,
    code: string,
  ): Promise<number> {
    const opened = this.cryptoService.open(secret);
    if (opened.underPreviousKey) {
      await this.accounts.replaceSecret(
        user,
        this.cryptoService.encrypt(opened.plaintext),
      );
    }

    const delta = checkTotpDelta(code, opened.plaintext);

    if (delta === null || delta === undefined) {
      throw this.invalidCode('code does not match the secret');
    }

    return Math.floor(Date.now() / TOTP_STEP_MS) + delta;
  }

  private invalidCode(reason: string): AppException {
    this.logger.warn(`Two-factor check failed: ${reason}`);
    return new AppException(
      ErrorCode.TWO_FACTOR_CODE_INVALID,
      'That code is not valid',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

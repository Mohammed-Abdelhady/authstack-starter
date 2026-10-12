import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
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
  ATTEMPT_RESERVATION,
  SecondFactorStore,
  SPEND_OUTCOME,
} from '../stores/second-factor.store';
import {
  lockDurationMs,
  retryAfterSeconds,
} from '../utils/second-factor-lock.util';

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
   * @throws AppException TWO_FACTOR_LOCKED while the account is locked
   */
  async verifySecondFactor(
    user: SecondFactorAccount,
    input: SecondFactorInput,
    unitOfWork?: UnitOfWork,
  ): Promise<void> {
    if (input.code) {
      await this.verifyTotpCode(user, input.code, unitOfWork);
      return;
    }

    if (input.recoveryCode) {
      await this.verifyRecoveryCode(user, input.recoveryCode, unitOfWork);
      return;
    }

    throw this.invalidCode('neither a code nor a recovery code was sent');
  }

  /** Count before opening the native unit of work, then spend within it. */
  async prepareNativeSecondFactor(
    user: SecondFactorAccount,
    input: SecondFactorInput,
  ): Promise<(unitOfWork: UnitOfWork) => Promise<void>> {
    const plaintext =
      input.code && user.twoFactor.secret
        ? await this.readSecret(user, user.twoFactor.secret)
        : null;
    await this.reserve(user);
    return async (unitOfWork) => {
      if (input.code && plaintext) {
        await this.spendCode(user, plaintext, input.code, unitOfWork);
      } else if (input.recoveryCode) {
        await this.spendRecovery(user, input.recoveryCode, unitOfWork);
      } else {
        throw this.invalidCode(
          'neither a usable code nor a recovery code was sent',
        );
      }
      await this.accounts.clearFailedAttemptsIn(unitOfWork, user);
    };
  }

  /**
   * Checks a code against the secret on the account, whether or not the second
   * factor is confirmed yet, and marks the step as spent.
   *
   * @throws AppException TWO_FACTOR_LOCKED while the account is locked
   */
  async verifyTotpCode(
    user: SecondFactorAccount,
    code: string,
    unitOfWork?: UnitOfWork,
  ): Promise<void> {
    const secret = user.twoFactor.secret;
    if (!secret) {
      throw this.invalidCode('account has no secret to check against');
    }

    // Read before the answer is counted: a key that reads nothing is the
    // server's fault and must not count against the account.
    const plaintext = await this.readSecret(user, secret);
    await this.counted(
      user,
      () => this.spendCode(user, plaintext, code, unitOfWork),
      unitOfWork,
    );
  }

  /**
   * Spends one recovery code. A code that was already spent is refused.
   *
   * @throws AppException TWO_FACTOR_LOCKED while the account is locked
   */
  async verifyRecoveryCode(
    user: SecondFactorAccount,
    recoveryCode: string,
    unitOfWork?: UnitOfWork,
  ): Promise<void> {
    await this.counted(
      user,
      () => this.spendRecovery(user, recoveryCode, unitOfWork),
      unitOfWork,
    );
  }

  /**
   * Counts the answer against the account, checks it, and clears the count
   * when it was right. The count is stored before the check, so answers sent
   * together cannot all be checked against one count: each needs its own.
   * Every fifth wrong answer in a row locks the account, for longer each
   * time, and nothing is checked while the lock holds.
   */
  private async counted(
    user: SecondFactorAccount,
    check: () => Promise<void>,
    unitOfWork?: UnitOfWork,
  ): Promise<void> {
    await this.reserve(user);
    await check();
    if (unitOfWork) await this.accounts.clearFailedAttemptsIn(unitOfWork, user);
    else await this.accounts.clearFailedAttempts(user);
  }

  private async reserve(user: SecondFactorAccount): Promise<void> {
    const now = Date.now();
    const { failedAttempts, lockedUntil } = user.twoFactor;
    if (lockedUntil && lockedUntil.getTime() > now) {
      throw this.locked(lockedUntil, now);
    }

    const counted = failedAttempts + 1;
    const lockMs = lockDurationMs(counted);
    const reservation = await this.accounts.reserveAttempt(user, {
      failedAttempts: counted,
      lockedUntil: lockMs > 0 ? new Date(now + lockMs) : null,
    });
    if (reservation !== ATTEMPT_RESERVATION.RESERVED) {
      throw this.invalidCode('another answer was counted for the account');
    }
  }

  private async spendCode(
    user: SecondFactorAccount,
    plaintext: string,
    code: string,
    unitOfWork?: UnitOfWork,
  ): Promise<void> {
    const delta = checkTotpDelta(code, plaintext);
    if (delta === null || delta === undefined) {
      throw this.invalidCode('code does not match the secret');
    }

    // The absolute step, counted from the epoch. Steps only ever move
    // forward, which is what makes a spent one detectable.
    const step = Math.floor(Date.now() / TOTP_STEP_MS) + delta;
    const lastUsedStep = user.twoFactor.lastUsedStep;

    if (typeof lastUsedStep === 'number' && step <= lastUsedStep) {
      throw this.invalidCode('code was already used');
    }

    const outcome = await this.accounts.spendTotpStep(user, step, unitOfWork);

    if (outcome !== SPEND_OUTCOME.SPENT) {
      throw this.invalidCode('code was already used');
    }
  }

  private async spendRecovery(
    user: SecondFactorAccount,
    recoveryCode: string,
    unitOfWork?: UnitOfWork,
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
      unitOfWork,
    );

    if (outcome !== SPEND_OUTCOME.SPENT) {
      throw this.invalidCode('recovery code is unknown or already used');
    }
  }

  /**
   * The secret in plain text. One the previous key still reads is written
   * again under the current key here, so the previous key can be dropped once
   * every account has answered a code.
   */
  private async readSecret(
    user: SecondFactorAccount,
    secret: StoredTotpSecret,
  ): Promise<string> {
    const opened = this.cryptoService.open(secret);
    if (opened.underPreviousKey) {
      await this.accounts.replaceSecret(
        user,
        this.cryptoService.encrypt(opened.plaintext),
      );
    }
    return opened.plaintext;
  }

  private locked(lockedUntil: Date, now: number): AppException {
    this.logger.warn('Two-factor check refused: the account is locked');
    return new AppException(
      ErrorCode.TWO_FACTOR_LOCKED,
      'Too many wrong codes. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfter: retryAfterSeconds(lockedUntil, now) },
    );
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

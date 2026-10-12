import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HashService } from '../../../common/services/hash.service';
import { Clock } from '../../../common/services/clock';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { generateVerificationCode } from '../../utils/verification-code.util';
import { INVALID_PASSWORD_RESET_CODE_MESSAGE } from '../../constants/auth-messages';
import { PENDING_STORE_PASSES } from '../../constants/pending-store';
import { CODE_GUESS_RULE } from '../../constants/registration';
import { currentRequestId } from '../../../common/context/request-context';
import { IdSource } from '../../interfaces/pending-code.interface';
import { PasswordResetCodeStore } from '../../pending-codes/password-reset-code.store';
import {
  CODE_CLAIM,
  CODE_ROTATION,
} from '../../pending-codes/pending-registration.store';

export interface ReservedPasswordReset {
  id: string;
  hashedCode: string;
}

/**
 * Password reset codes: creation, verification and cleanup.
 */
@Injectable()
export class PasswordResetCodeService {
  private readonly logger = new Logger(PasswordResetCodeService.name);
  private readonly codeExpiresIn: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly store: PasswordResetCodeStore,
    private readonly hashService: HashService,
    private readonly configService: ConfigService,
    private readonly clock: Clock,
  ) {
    this.codeExpiresIn = this.configService.get<number>(
      'activation.codeExpiresIn',
      900000,
    );
    this.maxAttempts = this.configService.get<number>(
      'activation.maxAttempts',
      5,
    );
  }

  /**
   * Store pending password reset code.
   * A guarded single write updates an existing record; when it matches
   * nothing there is no record, so the create path runs. A concurrent insert
   * sends the attempt around once more, which updates the record that won. If
   * a reset consumes that record in the window, the next pass creates it
   * again, so the mailed code always has a record behind it.
   *
   * @param email - Address the code belongs to
   * @returns The plain code to mail
   */
  async createOrUpdatePasswordReset(email: string): Promise<string> {
    const code = generateVerificationCode();
    const hashedCode = await this.hashService.hash(code);
    const expiresAt = new Date(this.clock.now().getTime() + this.codeExpiresIn);
    const generation = { hashedCode, expiresAt };

    for (let pass = 0; pass < PENDING_STORE_PASSES; pass += 1) {
      const rotated = await this.store.rotateCode(email, generation);
      if (rotated === CODE_ROTATION.ROTATED) {
        this.logger.log(
          `Opened pending password reset requestId=${currentRequestId() ?? 'unknown'}`,
        );
        return code;
      }

      try {
        await this.store.insertRecord(email, generation);
        this.logger.log(
          `Opened pending password reset requestId=${currentRequestId() ?? 'unknown'}`,
        );
        return code;
      } catch (error) {
        if (!(error instanceof UniqueConflictError)) throw error;
      }
    }

    throw new AppException(
      ErrorCode.INTERNAL_ERROR,
      'Could not store the pending password reset',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  /**
   * Atomically reserve one attempt, then compare the submitted code.
   * A valid code is not consumed here: the caller must win consumePasswordReset
   * before changing the password so two concurrent winners cannot both proceed.
   *
   * @param email - Address the code was sent to
   * @param code - Code the caller submitted
   * @throws AppException PASSWORD_RESET_CODE_INVALID for a wrong code, no
   * pending record, an expired record or a locked record
   */
  async verifyPasswordReset(
    email: string,
    code: string,
  ): Promise<ReservedPasswordReset> {
    const reserved = await this.store.reserveAttempt(email, {
      now: this.clock.now(),
      maxAttempts: this.maxAttempts,
      guesses: CODE_GUESS_RULE,
    });

    if (!reserved) {
      return await this.rejectUnreservable(email, code);
    }

    const isCodeValid = await this.hashService.compare(
      code,
      reserved.hashedCode,
    );

    if (!isCodeValid) {
      throw this.invalidCode();
    }

    return { id: reserved.id, hashedCode: reserved.hashedCode };
  }

  /**
   * Delete the reserved generation. Only the first caller that still holds
   * the hashed code that was compared wins; a refresh or a parallel consume
   * leaves this returning false.
   */
  async consumePasswordReset(
    id: IdSource,
    hashedCode: string,
  ): Promise<boolean> {
    const claim = await this.store.claimCode({
      id: id.toString(),
      hashedCode,
      now: this.clock.now(),
    });
    return claim === CODE_CLAIM.CLAIMED;
  }

  /**
   * The one answer every password reset code step that cannot succeed returns.
   * The attempt limit and the expiry check still decide whether a record can
   * be used; only the answer they produce is shared.
   */
  invalidCode(): AppException {
    return new AppException(
      ErrorCode.PASSWORD_RESET_CODE_INVALID,
      INVALID_PASSWORD_RESET_CODE_MESSAGE,
      HttpStatus.BAD_REQUEST,
    );
  }

  private async rejectUnreservable(
    email: string,
    code: string,
  ): Promise<never> {
    await this.store.dropExpiredRecord(email, this.clock.now());

    await this.hashService.spendComparison(code);
    throw this.invalidCode();
  }
}

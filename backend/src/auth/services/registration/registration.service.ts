import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { RegisterDto } from '../../dto/register.dto';
import { ActivateDto } from '../../dto/activate.dto';
import { ResendActivationDto } from '../../dto/resend-activation.dto';
import { RegisterResponseDto } from '../../dto/register-response.dto';
import { ActivateResponseDto } from '../../dto/activate-response.dto';
import { ResendActivationResponseDto } from '../../dto/resend-activation-response.dto';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { HashService } from '../../../common/services/hash.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AuthMailService } from '../mail/auth-mail.service';
import { VerificationCodeService } from '../codes/verification-code.service';
import { MailCounterService } from '../mail/mail-counter.service';
import {
  createActivatedAccount,
  finishActivation,
} from '../../utils/activation.util';
import { activationCodeInvalid } from '../../utils/activation-error.util';
import { generateVerificationCode } from '../../utils/verification-code.util';
import { isUnknownTransactionOutcome } from '../../../common/exceptions/unknown-transaction-outcome.error';
import { storeFailureCause } from '../../../common/persistence/store-failure';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import {
  ActivatedAccount,
  ActivationAccounts,
  ActivationSignIn,
} from '../../pending-codes/activation-accounts';
import {
  PENDING_PURPOSE,
  MAIL_COUNTER_PURPOSE,
} from '../../constants/registration';
import { REGISTRATION_CONTRACT_OUTDATED_MESSAGE } from '../../constants/auth-messages';
import { logUnknownCommit } from '../../utils/unknown-commit.util';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';

/**
 * The sign-up code flows: start a registration, activate with the mailed code,
 * and resend a sign-up code. Anything that proves an address on an existing
 * account goes through the email-change confirmation or an admin re-send.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly accounts: ActivationAccounts,
    private readonly runner: UnitOfWorkRunner,
    private readonly hashService: HashService,
    private readonly authMailService: AuthMailService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly mailCounterService: MailCounterService,
    private readonly signIn: ActivationSignIn,
  ) {}

  /**
   * Start a registration. The body carries the address only; an old client
   * that still sends a password or a name is refused by the body alone, before
   * any address look-up. Any address that already has a non-deleted account is
   * treated like a verified one: a capped notice, no sign-up record, and the
   * generic reply, because a sign-up code could never activate it.
   */
  async register(dto: RegisterDto): Promise<ApiResponse<RegisterResponseDto>> {
    if (dto.password !== undefined || dto.name !== undefined) {
      throw new AppException(
        ErrorCode.REGISTRATION_CONTRACT_OUTDATED,
        REGISTRATION_CONTRACT_OUTDATED_MESSAGE,
        HttpStatus.BAD_REQUEST,
      );
    }

    const existingUser = await this.accounts.findAddressOwner(dto.email);

    if (existingUser) {
      await this.spendCodeHashingTime();
      // A soft-deleted account keeps its address: answer like a taken one and
      // send no notice, because the address has no live owner to warn.
      if (!existingUser.isDeleted) {
        const underCap = await this.mailCounterService.tryRecord(
          dto.email,
          MAIL_COUNTER_PURPOSE.NOTICE,
        );
        if (underCap) {
          this.authMailService.deferRegistrationAttemptNotice(
            dto.email,
            existingUser.name,
          );
        }
      }
      return RegisterResponseDto.success(dto.email);
    }

    const issued =
      await this.verificationCodeService.createOrUpdatePendingRegistration(
        dto.email,
        PENDING_PURPOSE.SIGNUP,
      );

    if (issued) {
      this.authMailService.deferActivationCode(dto.email, issued.code);
    }

    return RegisterResponseDto.success(dto.email);
  }

  /**
   * Prove the address with the mailed code, then create the account with the
   * password and name supplied in this same request. The code comparison and
   * the password hash run outside the unit of work; the consume and the insert
   * run inside one, so a rerun cannot spend another attempt or hash twice.
   */
  async activate(
    dto: ActivateDto,
    response: Response,
  ): Promise<ApiResponse<ActivateResponseDto>> {
    const reserved = await this.verificationCodeService.verifyCode(
      dto.email,
      dto.code,
      PENDING_PURPOSE.SIGNUP,
    );
    const passwordHash = await this.hashService.hash(dto.password);
    // Generate the id before the unit of work, so an unknown commit can be
    // resolved by looking this exact account up afterwards.
    const accountId = this.accounts.newAccountId();

    let user: ActivatedAccount;
    try {
      user = await this.runner.run(async (unitOfWork) => {
        const consumed = await this.verificationCodeService.consumeCode(
          reserved,
          unitOfWork,
        );
        if (!consumed) {
          throw activationCodeInvalid();
        }
        return createActivatedAccount(this.accounts, unitOfWork, reserved, {
          id: accountId,
          passwordHash,
          name: dto.name,
        });
      });
    } catch (error) {
      if (isUnknownTransactionOutcome(error)) {
        return this.finishUnknownCommit(accountId, error);
      }
      throw storeFailureCause(error);
    }

    this.logger.log(`Account activated: user ${user.id}`);
    return finishActivation(this.signIn, user, response);
  }

  /**
   * Mail a fresh activation code for a pending sign-up. Any address that
   * already has a non-deleted account, verified or not, gets the generic reply
   * and no mail: its code can never activate.
   */
  async resendActivation(
    dto: ResendActivationDto,
  ): Promise<ApiResponse<ResendActivationResponseDto>> {
    const existingUser = await this.accounts.findAddressOwner(dto.email);

    if (existingUser) {
      await this.spendCodeHashingTime();
      return ResendActivationResponseDto.success(dto.email);
    }

    const issued = await this.verificationCodeService.resendActivationCode(
      dto.email,
      PENDING_PURPOSE.SIGNUP,
    );

    if (issued) {
      this.authMailService.deferActivationCode(dto.email, issued.code);
    }

    return ResendActivationResponseDto.success(dto.email);
  }

  /**
   * A commit whose result is unknown may or may not have landed. Only answer
   * "sign in" when this caller's own account — the id generated before the
   * unit of work — is really there. An absent or unreadable row remains an
   * unknown outcome and answers with its 503 code. Looking up by address alone
   * could match an account a concurrent sign-in method created and tell this
   * caller to sign in to a password they never set.
   */
  private async finishUnknownCommit(
    accountId: string,
    error: unknown,
  ): Promise<ApiResponse<ActivateResponseDto>> {
    let committed = false;
    try {
      committed = await this.accounts.isStored(accountId);
    } catch {
      logUnknownCommit(this.logger, 'Activation', error);
      asAuthorityUnavailable(error);
    }

    if (committed) {
      logUnknownCommit(this.logger, 'Activation', error);
      return ActivateResponseDto.signInRequired();
    }
    asAuthorityUnavailable(error);
  }

  /**
   * Spend the bcrypt time a real code would have cost.
   * Requests for addresses without an account take as long as requests for
   * addresses with one.
   */
  private async spendCodeHashingTime(): Promise<void> {
    await this.hashService.hash(generateVerificationCode());
  }
}

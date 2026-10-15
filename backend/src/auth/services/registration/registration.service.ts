import { SelfSignUpRefusedError } from './self-sign-up-refused.error';
import { finishUnknownActivation } from './finish-unknown-activation';
import { BrowserApplications } from '../../../session/applications/browser-applications';
import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { AddressLedger } from '../../../common/persistence/address-ledger';
import { Clock } from '../../../common/services/clock';
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
import type { SupportedLocale } from '../../../common/constants/locales';
import { WEB_CLIENT_ID } from '../../../session/constants/client-ids';
import { AccountCreationPolicy } from './account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';

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
    private readonly policy: AccountCreationPolicy,
    private readonly ledger: AddressLedger,
    private readonly clock: Clock,
    private readonly applications: BrowserApplications,
  ) {}

  /**
   * Start a registration. The body carries the address only; an old client
   * that still sends a password or a name is refused by the body alone, before
   * any address look-up. Any address that already has a non-deleted account is
   * treated like a verified one: a capped notice, no sign-up record, and the
   * generic reply, because a sign-up code could never activate it. The code
   * is written in the request's language; a notice in the account's.
   */
  async register(
    dto: RegisterDto,
    locale: SupportedLocale,
    request?: Request,
  ): Promise<ApiResponse<RegisterResponseDto>> {
    if (dto.password !== undefined || dto.name !== undefined) {
      throw new AppException(
        ErrorCode.REGISTRATION_CONTRACT_OUTDATED,
        REGISTRATION_CONTRACT_OUTDATED_MESSAGE,
        HttpStatus.BAD_REQUEST,
      );
    }

    const application = await this.applications.resolve(request);
    await this.requestRegistrationCode(
      dto.email,
      false,
      locale,
      application.clientId,
    );
    return RegisterResponseDto.success(dto.email);
  }

  /** Same generic registration request, with a private generation commitment. */
  async registerForNative(
    email: string,
    locale: SupportedLocale,
    clientId: string,
    bindCodeToApplication = false,
  ): Promise<string | null> {
    return this.requestRegistrationCode(
      email,
      true,
      locale,
      clientId,
      bindCodeToApplication,
    );
  }

  private async requestRegistrationCode(
    email: string,
    includeGeneration: boolean,
    locale: SupportedLocale,
    application = WEB_CLIENT_ID,
    bindNativeCode = false,
  ): Promise<string | null> {
    if (!(await this.mayIssueRegistrationCode(application))) {
      await this.spendCodeHashingTime();
      return null;
    }
    const free = await this.runner.run((uow) =>
      this.ledger.isFree(uow, { address: email, now: this.clock.now() }),
    );
    const existingUser = free
      ? null
      : await this.accounts.findAddressOwner(email);
    if (!free && !existingUser) {
      await this.spendCodeHashingTime();
      return null;
    }

    if (existingUser) {
      await this.spendCodeHashingTime();
      // A soft-deleted account keeps its address: answer like a taken one and
      // send no notice, because the address has no live owner to warn.
      if (!existingUser.isDeleted) {
        const underCap = await this.mailCounterService.tryRecord(
          email,
          MAIL_COUNTER_PURPOSE.NOTICE,
        );
        if (underCap) {
          this.authMailService.deferRegistrationAttemptNotice(
            { email, locale: existingUser.locale },
            existingUser.name,
          );
        }
      }
      return null;
    }

    if (includeGeneration) {
      const issued =
        await this.verificationCodeService.createOrUpdatePendingRegistrationWithGeneration(
          email,
          PENDING_PURPOSE.SIGNUP,
          bindNativeCode ? { application } : {},
        );
      if (issued) {
        this.authMailService.deferActivationCode(
          { email, locale },
          issued.code,
        );
      }
      return issued?.generationHash ?? null;
    }

    const issued =
      await this.verificationCodeService.createOrUpdatePendingRegistration(
        email,
        PENDING_PURPOSE.SIGNUP,
        { application },
      );
    if (issued) {
      this.authMailService.deferActivationCode({ email, locale }, issued.code);
    }
    return null;
  }

  /**
   * Prove the address with the mailed code, then create the account with the
   * password and name supplied in this same request. The code comparison and
   * the password hash run outside the unit of work; the consume and the insert
   * run inside one, so a rerun cannot spend another attempt or hash twice.
   * The account stores the language of this request.
   */
  async activate(
    dto: ActivateDto,
    response: Response,
    locale: SupportedLocale,
  ): Promise<ApiResponse<ActivateResponseDto>> {
    const application = (await this.applications.resolve(response.req))
      .clientId;
    const reserved = await this.verificationCodeService.verifyCode(
      dto.email,
      dto.code,
      PENDING_PURPOSE.SIGNUP,
      application,
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
        return createActivatedAccount(
          this.accounts,
          unitOfWork,
          reserved,
          {
            id: accountId,
            passwordHash,
            name: dto.name,
            locale,
          },
          this.policy,
          application,
          this.ledger,
          this.clock.now(),
        );
      });
    } catch (error) {
      if (isUnknownTransactionOutcome(error)) {
        return finishUnknownActivation(
          this.accounts,
          this.logger,
          accountId,
          error,
        );
      }
      const cause = storeFailureCause(error);
      if (cause instanceof SelfSignUpRefusedError) {
        await this.signIn.recordCreationRefusal(application);
        throw activationCodeInvalid();
      }
      throw cause;
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
    locale: SupportedLocale,
    request?: Request,
  ): Promise<ApiResponse<ResendActivationResponseDto>> {
    const application = (await this.applications.resolve(request)).clientId;
    if (!(await this.mayIssueRegistrationCode(application))) {
      await this.spendCodeHashingTime();
      return ResendActivationResponseDto.success(dto.email);
    }
    const free = await this.runner.run((uow) =>
      this.ledger.isFree(uow, { address: dto.email, now: this.clock.now() }),
    );
    const existingUser = free
      ? null
      : await this.accounts.findAddressOwner(dto.email);

    if (!free || existingUser) {
      await this.spendCodeHashingTime();
      return ResendActivationResponseDto.success(dto.email);
    }

    const issued = await this.verificationCodeService.resendActivationCode(
      dto.email,
      PENDING_PURPOSE.SIGNUP,
      { application },
    );

    if (issued) {
      this.authMailService.deferActivationCode(
        { email: dto.email, locale },
        issued.code,
      );
    }

    return ResendActivationResponseDto.success(dto.email);
  }

  /** Closed registration has the same reply and mail behavior for every address. */
  private async mayIssueRegistrationCode(
    application: string,
  ): Promise<boolean> {
    try {
      await this.runner.run((unitOfWork) =>
        this.policy.assertMayCreate(
          { application, method: ACCOUNT_CREATION_METHOD.PASSWORD },
          unitOfWork,
        ),
      );
      return true;
    } catch (error) {
      if (!(storeFailureCause(error) instanceof SelfSignUpRefusedError)) {
        throw error;
      }
      await this.signIn.recordCreationRefusal(application);
      return false;
    }
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

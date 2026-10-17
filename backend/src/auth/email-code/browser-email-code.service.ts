import { EventRecorder } from '../contracts/event-recorder';
import {
  SECURITY_EVENT_ACTION,
  SECURITY_EVENT_OUTCOME,
} from '../../session/constants/security-event-action';
import { PasskeyRequiredRefused } from '../../session/utils/authority/passkey-sign-in';
import { asAuthorityUnavailable } from '../../session/utils/authority/authority-unavailable';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErasureRefusal } from '../../user/erasure/services/erasure-refusal';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { requestLocaleOf } from '../../common/decorators/request-locale.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { AddressLedger } from '../../common/persistence/address-ledger';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import { HashService } from '../../common/services/hash.service';
import { BrowserApplications } from '../../session/applications/browser-applications';
import { AudienceAdmissionRefused } from '../../session/utils/authority/audience-admission';
import { ACCOUNT_CREATION_METHOD } from '../constants/account-creation';
import { LoginResponseDto } from '../dto/login-response.dto';
import { AuthFeature } from '../enums/auth-feature.enum';
import { MagicLinkAccountCreation } from '../magic-link/magic-link-account-creation';
import {
  MagicLinkAccounts,
  type MagicLinkAccount,
} from '../magic-link/stores/magic-link-accounts';
import { NativeEmailCodeCeilingService } from '../native/lifecycle/native-email-code-ceiling.service';
import {
  EmailCodeStore,
  EMAIL_CODE_GUESS_LIMIT,
  type StoredEmailCode,
} from '../pending-codes/email-code.store';
import { AuthFeaturesService } from '../services/features/auth-features.service';
import { AccountCreationPolicy } from '../services/registration/account-creation-policy';
import { AccountCreationRefusedError } from '../services/registration/account-creation-refused.error';
import { AccountProfileStore } from '../../user/stores/account-profile.store';
import { SignInCompletion } from '../services/sessions/sign-in-completion';
import { FIRST_FACTOR } from '../services/sessions/first-factor';
import { BrowserEmailCodeCookieService } from './browser-email-code-cookie.service';
import { BrowserEmailCodeMailService } from './browser-email-code-mail.service';
import type {
  RequestBrowserEmailCodeDto,
  VerifyBrowserEmailCodeDto,
} from './browser-email-code.dto';

function invalidCode(): AppException {
  return new AppException(
    ErrorCode.EMAIL_CODE_INVALID,
    'Email code invalid',
    HttpStatus.BAD_REQUEST,
  );
}

export interface BrowserEmailCodeServiceDependencies {
  applications: BrowserApplications;
  features: AuthFeaturesService;
  cookies: BrowserEmailCodeCookieService;
  issuer: BrowserEmailCodeMailService;
  codes: EmailCodeStore;
  hash: HashService;
  clock: Clock;
  runner: UnitOfWorkRunner;
  accounts: MagicLinkAccounts;
  signIn: SignInCompletion;
  profiles: AccountProfileStore;
  ceiling: NativeEmailCodeCeilingService;
  policy: AccountCreationPolicy;
  ledger: AddressLedger;
  erasure: ErasureRefusal;
  events: EventRecorder;
}

@Injectable()
export class BrowserEmailCodeService {
  private readonly creation: MagicLinkAccountCreation;

  constructor(
    private readonly dependencies: BrowserEmailCodeServiceDependencies,
  ) {
    this.creation = new MagicLinkAccountCreation({
      accounts: dependencies.accounts,
      runner: dependencies.runner,
      policy: dependencies.policy,
      ledger: dependencies.ledger,
      clock: dependencies.clock,
      invalidLink: invalidCode,
    });
  }

  async request(
    dto: RequestBrowserEmailCodeDto,
    request: Request,
    response: Response,
  ): Promise<ApiResponse<{ email: string }>> {
    await this.dependencies.features.assertForRequest(
      AuthFeature.EMAIL_CODE,
      request,
    );
    const previous = this.dependencies.cookies.read(request);
    if (previous)
      await this.dependencies.runner.run(async (work) => {
        const stored = await this.dependencies.codes.findIn(work, previous);
        if (stored)
          await this.dependencies.codes.cancelIn(work, stored, stored.codeHash);
      });
    const key = this.dependencies.cookies.bind(request, response);
    await this.dependencies.issuer.issue(
      key,
      { email: dto.email, locale: requestLocaleOf(request) },
      this.dependencies.applications.current(request).clientId,
    );
    return ApiResponse.success({ email: dto.email });
  }

  async verify(
    dto: VerifyBrowserEmailCodeDto,
    request: Request,
    response: Response,
  ): Promise<ApiResponse<LoginResponseDto>> {
    await this.dependencies.features.assertForRequest(
      AuthFeature.EMAIL_CODE,
      request,
    );
    const key = this.dependencies.cookies.read(request);
    const stored = key ? await this.dependencies.codes.find(key) : null;
    if (!stored || !this.live(stored)) {
      await this.dependencies.hash.spendComparison(dto.code);
      throw invalidCode();
    }
    if (!(await this.dependencies.hash.compare(dto.code, stored.codeHash))) {
      await this.dependencies.codes.recordWrongGuess(
        stored,
        EMAIL_CODE_GUESS_LIMIT,
      );
      await this.dependencies.ceiling.countWrongGuess(stored.email);
      throw invalidCode();
    }
    let targetUserId: string | undefined;
    try {
      const outcome = await this.dependencies.runner.run(async (work) => {
        if (
          !(await this.dependencies.codes.spendIn(work, stored, {
            codeHash: stored.codeHash,
            limit: EMAIL_CODE_GUESS_LIMIT,
          }))
        )
          throw invalidCode();
        const account = await this.account(work, stored.email, request);
        targetUserId = account.id;
        const profile = await this.dependencies.profiles.readAccount(
          work,
          account.id,
        );
        if (!profile || profile.isDeleted || profile.email !== stored.email)
          throw invalidCode();
        return this.dependencies.signIn.completeSignInIn(work, {
          user: profile,
          response,
          firstFactor: FIRST_FACTOR.EMAIL_CODE,
          admit: (application) => {
            if (application.signInMethods?.emailCode === false)
              throw invalidCode();
          },
        });
      });
      this.dependencies.cookies.release(response);
      return outcome.requiresTwoFactor
        ? LoginResponseDto.twoFactorRequired()
        : LoginResponseDto.success(outcome.user);
    } catch (error) {
      return this.refuse(error, request, targetUserId);
    }
  }

  private async refuse(
    error: unknown,
    request: Request,
    targetUserId?: string,
  ): Promise<never> {
    const clientId = this.dependencies.applications.current(request).clientId;
    if (error instanceof AudienceAdmissionRefused) {
      try {
        await this.dependencies.events.recordOutsideUnitOfWork({
          action:
            error instanceof PasskeyRequiredRefused
              ? SECURITY_EVENT_ACTION.PASSKEY_REQUIRED
              : SECURITY_EVENT_ACTION.AUDIENCE_REFUSED,
          outcome: SECURITY_EVENT_OUTCOME.FAILED,
          clientId,
          ...(targetUserId ? { targetUserId } : {}),
        });
      } catch (failure) {
        asAuthorityUnavailable(failure);
      }
      throw invalidCode();
    }
    if (error instanceof AccountCreationRefusedError) {
      await this.dependencies.signIn.recordCreationRefusal(
        clientId,
        ACCOUNT_CREATION_METHOD.EMAIL_CODE,
      );
      throw invalidCode();
    }
    throw error;
  }

  private live(stored: StoredEmailCode): boolean {
    return (
      stored.spentAt === null &&
      stored.wrongGuesses < EMAIL_CODE_GUESS_LIMIT &&
      stored.expiresAt.getTime() > this.dependencies.clock.now().getTime()
    );
  }

  private async account(
    work: UnitOfWork,
    email: string,
    request: Request,
  ): Promise<MagicLinkAccount> {
    const account = await this.dependencies.accounts.findByEmailIn(work, email);
    if (account?.isDeleted)
      throw await this.dependencies.erasure.refusalFor(
        account.id,
        invalidCode(),
      );
    if (!account) {
      return this.creation.createIn(work, {
        email,
        locale: requestLocaleOf(request),
        application: this.dependencies.applications.current(request).clientId,
        method: ACCOUNT_CREATION_METHOD.EMAIL_CODE,
      });
    }
    if (
      !account.isVerified &&
      !(await this.dependencies.accounts.markVerifiedIn(work, account))
    )
      throw invalidCode();
    return account;
  }
}

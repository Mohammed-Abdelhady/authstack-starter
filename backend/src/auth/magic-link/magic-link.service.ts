import { ErasureRefusal } from '../../user/erasure/services/erasure-refusal';
import { Optional } from '@nestjs/common';
import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { MagicLinkAccountCreation } from './magic-link-account-creation';
import { AddressLedger } from '../../common/persistence/address-ledger';
import { MagicLinkStore } from './stores/magic-link.store';
import { MagicLinkVerification } from './magic-link-verification';
import type { MagicLinkLoginResponseData } from './types/magic-link-login-response';
import { MagicLinkBrowserService } from './magic-link-browser.service';
import { MagicLinkCeremonies } from './magic-link-ceremonies';
import { BrowserApplications } from '../../session/applications/browser-applications';
import type { BrowserApplicationId } from '../../session/applications/types/browser-application';
import {
  browserMagicLinkUrl,
  createBrowserMagicLinkToken,
} from './utils/magic-link-browser-context';
import {
  MagicLinkAccounts,
  MagicLinkSignIn,
} from './stores/magic-link-accounts';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { MagicLinkRequestResponseDto } from './dto/magic-link-request-response.dto';
import {
  MAGIC_LINK_INVALID_MESSAGE,
  MAGIC_LINK_RATE_WINDOW_MS,
} from './constants/magic-link.constants';
import { hashMagicLinkToken } from './utils/magic-link-token.util';
import { requestLocaleOf } from '../../common/decorators/request-locale.decorator';
import type { MailRecipient } from '../../mail/types/mail-recipient.types';
import { AuthMailService } from '../services/mail/auth-mail.service';
import { SIGN_IN_LINK_EMAIL_FAILED_MESSAGE } from '../constants/auth-messages';
import { MailDispatcherService } from '../../mail/mail-dispatcher.service';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { Clock } from '../../common/services/clock';
import { currentRequestId } from '../../common/context/request-context';
import { getAllowedNativeAuthorizeContinuation } from './utils/magic-link-continuation.util';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { AccountCreationPolicy } from '../services/registration/account-creation-policy';

const MILLISECONDS_PER_MINUTE = 60000;

/**
 * Passwordless sign-in. A request mails a one-time link; verifying it creates
 * the session, and creates the account when the address has none.
 */
@Injectable()
export class MagicLinkService implements OnModuleInit {
  private readonly logger = new Logger(MagicLinkService.name);
  private readonly expiresIn: number;
  private readonly maxPerHour: number;
  private readonly accountCreation: MagicLinkAccountCreation;
  private readonly ceremonies: MagicLinkCeremonies;
  private readonly verification: MagicLinkVerification;

  constructor(
    private readonly links: MagicLinkStore,
    private readonly accounts: MagicLinkAccounts,
    private readonly configService: ConfigService,
    private readonly authMailService: AuthMailService,
    private readonly mailDispatcher: MailDispatcherService,
    signIn: MagicLinkSignIn,
    private readonly browser: MagicLinkBrowserService,
    private readonly clock: Clock,
    policy: AccountCreationPolicy,
    ledger: AddressLedger,
    runner: UnitOfWorkRunner,
    private readonly applications: BrowserApplications,
    @Optional() private readonly erasure?: ErasureRefusal,
  ) {
    this.ceremonies = new MagicLinkCeremonies(links, this.applications, clock);
    this.expiresIn = this.configService.get<number>(
      'magicLink.expiresIn',
      900000,
    );
    this.maxPerHour = this.configService.get<number>('magicLink.maxPerHour', 5);
    this.accountCreation = new MagicLinkAccountCreation({
      accounts,
      runner,
      policy,
      ledger,
      clock,
      invalidLink: () => this.invalidLink('address is taken'),
    });
    this.verification = new MagicLinkVerification({
      links,
      accounts,
      signIn,
      browser,
      ceremonies: this.ceremonies,
      applications,
      clock,
      accountCreation: this.accountCreation,
      deletedRefusal: async (userId, failure) =>
        this.erasure?.refusalFor(userId, failure) ?? failure,
      invalidLink: (reason) => this.invalidLink(reason),
    });
  }

  onModuleInit(): void {
    this.ceremonies.register();
  }

  /**
   * Mail a sign-in link. An address without an account gets one too, because
   * following it is how a passwordless account is created. A soft-deleted
   * account and an address over the hourly cap get the reply and no mail.
   *
   * Every request does the same work, so the time an answer takes says
   * nothing about the address: one account read, one slot taken from the cap,
   * one link stored. A request that mails nothing stores a link that is
   * already spent and whose token is thrown away. The mail leaves through the
   * dispatcher, so no answer waits on SMTP. Every answer also leaves the nonce
   * that ties the link to this browser. The mail is in the account's
   * language, or the request's when the address has no account.
   */
  async request(
    dto: RequestMagicLinkDto,
    request: Request,
    response: Response,
  ): Promise<ApiResponse<MagicLinkRequestResponseDto>> {
    const application = await this.applications.resolve(request);
    this.applications.assertEnabled(application);
    const now = this.clock.now();
    const requestNonceHash = this.browser.bind(request, response);
    const owner = await this.accounts.findLinkRecipient(dto.email);
    const deleted = owner?.isDeleted === true;
    const underCap = await this.links.takeRequestSlot(dto.email, {
      now,
      windowMs: MAGIC_LINK_RATE_WINDOW_MS,
      limit: this.maxPerHour,
    });
    const mailed = !deleted && underCap;

    const token = createBrowserMagicLinkToken(application.clientId);
    const redirect = getAllowedNativeAuthorizeContinuation(dto.redirect);
    await this.links.insertLink({
      email: dto.email,
      tokenHash: hashMagicLinkToken(token),
      expiresAt: new Date(now.getTime() + this.expiresIn),
      requestIp: request.ip,
      userAgent: request.headers['user-agent'],
      requestNonceHash,
      ...(redirect ? { redirect } : {}),
      ...(mailed ? {} : { consumedAt: now }),
    });

    const requestId = currentRequestId() ?? 'unknown';
    if (mailed) {
      const locale = owner?.locale ?? requestLocaleOf(request);
      this.deferLink(
        { email: dto.email, locale },
        token,
        requestId,
        application.clientId,
      );
    } else if (deleted) {
      this.logger.warn('Magic link request for a deleted account');
    } else {
      this.logger.warn(`Magic link hourly cap reached requestId=${requestId}`);
    }
    return MagicLinkRequestResponseDto.success(dto.email);
  }

  /**
   * Spend a link and sign its owner in. An account with a second factor gets
   * the challenge cookie and `requiresTwoFactor` instead of a session.
   *
   * A token alone signs nobody in. Unless the caller says a person confirmed
   * it, the link is spent only in the browser that asked for it, and only when
   * that browser is not signed in to another account. Otherwise the answer is
   * `requiresConfirmation` with the masked address, and the link stays unspent.
   * An account it creates stores the language of this request.
   *
   * @throws AppException MAGIC_LINK_INVALID when the token is unknown, already
   * spent, expired, or belongs to a deleted account
   */
  async verify(
    dto: VerifyMagicLinkDto,
    request: Request,
    response: Response,
  ): Promise<ApiResponse<MagicLinkLoginResponseData>> {
    return this.verification.verify(dto, request, response);
  }

  /** Start the mail and return at once. A dropped send is logged, not thrown. */
  private deferLink(
    recipient: MailRecipient,
    token: string,
    requestId: string,
    clientId: BrowserApplicationId,
  ): void {
    this.mailDispatcher.dispatch(async () => {
      const sent = await this.authMailService.sendMagicLink(
        recipient,
        browserMagicLinkUrl(
          this.configService,
          this.applications.configuration(clientId),
          recipient,
          token,
        ),
        Math.round(this.expiresIn / MILLISECONDS_PER_MINUTE),
      );
      if (sent) {
        this.logger.log(`Magic link sent requestId=${requestId}`);
      }
    }, SIGN_IN_LINK_EMAIL_FAILED_MESSAGE);
  }

  private invalidLink(reason: string): AppException {
    this.logger.warn(`Magic link rejected: ${reason}`);
    return new AppException(
      ErrorCode.MAGIC_LINK_INVALID,
      MAGIC_LINK_INVALID_MESSAGE,
      HttpStatus.BAD_REQUEST,
    );
  }
}

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { MagicLinkStore, UnspentMagicLink } from './stores/magic-link.store';
import { MagicLinkBrowserService } from './magic-link-browser.service';
import {
  MagicLinkAccount,
  MagicLinkAccounts,
  MagicLinkSignIn,
} from './stores/magic-link-accounts';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';
import { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import { MagicLinkRequestResponseDto } from './dto/magic-link-request-response.dto';
import {
  MAGIC_LINK_CONFIRM_MESSAGE,
  MAGIC_LINK_INVALID_MESSAGE,
  MAGIC_LINK_RATE_WINDOW_MS,
} from './constants/magic-link.constants';
import {
  createMagicLinkToken,
  deriveNameFromEmail,
  hashMagicLinkToken,
  sameHash,
} from './utils/magic-link-token.util';
import type { SupportedLocale } from '../../common/constants/locales';
import { requestLocaleOf } from '../../common/decorators/request-locale.decorator';
import { MAIL_NAME } from '../../mail/constants/mail-names';
import { mailLink } from '../../mail/links/mail-links';
import type { MailRecipient } from '../../mail/types/mail-recipient.types';
import { LoginResponseDto } from '../dto/login-response.dto';
import { AuthMailService } from '../services/mail/auth-mail.service';
import { SIGN_IN_LINK_EMAIL_FAILED_MESSAGE } from '../constants/auth-messages';
import { MailDispatcherService } from '../../mail/mail-dispatcher.service';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { UniqueConflictError } from '../../common/persistence/persistence-errors';
import { Clock } from '../../common/services/clock';
import { currentRequestId } from '../../common/context/request-context';
import { maskEmail } from './utils/mask-email.util';
import { getAllowedNativeAuthorizeContinuation } from './utils/magic-link-continuation.util';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { WEB_CLIENT_ID } from '../../session/constants/client-ids';
import { AccountCreationPolicy } from '../services/registration/account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../constants/account-creation';

const MILLISECONDS_PER_MINUTE = 60000;
type MagicLinkLoginResponseData = LoginResponseDto & {
  redirect?: string;
  /** True when the link was not spent and a person has to confirm it. */
  requiresConfirmation?: true;
  /** The address the link belongs to, masked, for the confirmation screen. */
  email?: string;
};

/**
 * Passwordless sign-in. A request mails a one-time link; verifying it creates
 * the session, and creates the account when the address has none.
 */
@Injectable()
export class MagicLinkService {
  private readonly logger = new Logger(MagicLinkService.name);
  private readonly expiresIn: number;
  private readonly maxPerHour: number;

  constructor(
    private readonly links: MagicLinkStore,
    private readonly accounts: MagicLinkAccounts,
    private readonly configService: ConfigService,
    private readonly authMailService: AuthMailService,
    private readonly mailDispatcher: MailDispatcherService,
    private readonly signIn: MagicLinkSignIn,
    private readonly browser: MagicLinkBrowserService,
    private readonly clock: Clock,
    private readonly policy: AccountCreationPolicy,
    private readonly runner: UnitOfWorkRunner,
  ) {
    this.expiresIn = this.configService.get<number>(
      'magicLink.expiresIn',
      900000,
    );
    this.maxPerHour = this.configService.get<number>('magicLink.maxPerHour', 5);
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

    const token = createMagicLinkToken();
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
      this.deferLink({ email: dto.email, locale }, token, requestId);
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
    const now = this.clock.now();
    const tokenHash = hashMagicLinkToken(dto.token);

    if (dto.confirm !== true) {
      const pending = await this.links.findUnspentLink(tokenHash);
      if (!pending) {
        throw this.invalidLink('token is unknown or already used');
      }
      if (pending.expiresAt.getTime() <= now.getTime()) {
        throw this.invalidLink('token has expired');
      }
      if (await this.needsConfirmation(pending, request)) {
        this.logger.log('Magic link awaits confirmation');
        return ApiResponse.success(
          {
            requiresTwoFactor: false,
            user: null,
            requiresConfirmation: true,
            email: maskEmail(pending.email),
          },
          MAGIC_LINK_CONFIRM_MESSAGE,
        );
      }
    }

    const link = await this.links.claimLink(tokenHash, now);

    if (!link) {
      throw this.invalidLink('token is unknown or already used');
    }

    if (link.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw this.invalidLink('token has expired');
    }

    const user = await this.resolveUser(link.email, requestLocaleOf(request));
    const outcome = await this.signIn.complete(user, response);
    this.browser.release(response);

    let loginResponse: ApiResponse<LoginResponseDto>;
    if (outcome.requiresTwoFactor) {
      this.logger.log(`Link spent, second factor owed: userId=${user.id}`);
      loginResponse = LoginResponseDto.twoFactorRequired();
    } else {
      this.logger.log(`User signed in with a magic link: userId=${user.id}`);
      loginResponse = LoginResponseDto.success(outcome.user);
    }

    const data: MagicLinkLoginResponseData = {
      ...loginResponse.data,
      ...(link.redirect ? { redirect: link.redirect } : {}),
    };
    return ApiResponse.success(data, loginResponse.message);
  }

  /**
   * True when the token did not come back to the browser that asked for it,
   * or that browser is signed in to an account the link does not belong to.
   */
  private async needsConfirmation(
    pending: UnspentMagicLink,
    request: Request,
  ): Promise<boolean> {
    const presented = this.browser.presentedNonceHash(request);
    if (
      !presented ||
      !pending.requestNonceHash ||
      !sameHash(presented, pending.requestNonceHash)
    ) {
      return true;
    }

    const sessionAccountId = await this.browser.sessionAccountId(request);
    if (sessionAccountId === null) {
      return false;
    }
    const owner = await this.accounts.findByEmail(pending.email);
    return owner?.id !== sessionAccountId;
  }

  /**
   * The account behind a spent link. Following the link proves control of the
   * address, so it both creates the account and verifies an existing one.
   */
  private async resolveUser(
    email: string,
    locale: SupportedLocale,
  ): Promise<MagicLinkAccount> {
    const existing = await this.accounts.findByEmail(email);

    if (existing?.isDeleted) {
      throw this.invalidLink('account is deleted');
    }

    if (existing) {
      if (!existing.isVerified) {
        await this.accounts.markVerified(existing);
      }
      return existing;
    }

    return this.createUser(email, locale);
  }

  /**
   * Create the passwordless account. It carries no password hash, which is how
   * the rest of the application tells that password sign-in does not apply.
   */
  private async createUser(
    email: string,
    locale: SupportedLocale,
  ): Promise<MagicLinkAccount> {
    try {
      const user = await this.runner.run(async (unitOfWork) => {
        await this.policy.assertMayCreate(
          {
            application: WEB_CLIENT_ID,
            method: ACCOUNT_CREATION_METHOD.MAGIC_LINK,
          },
          unitOfWork,
        );
        return this.accounts.createPasswordlessIn(unitOfWork, {
          email,
          name: deriveNameFromEmail(email),
          locale,
        });
      });

      this.logger.log('Created a new account from a magic link');
      return user;
    } catch (error) {
      if (!(error instanceof UniqueConflictError)) {
        throw error;
      }

      // Two links for the same new address were spent at once.
      const created = await this.accounts.findByEmail(email);
      if (!created) {
        // Still the database's own refusal, which is what the global filter
        // answers with a conflict.
        throw error.cause instanceof Error ? error.cause : error;
      }
      return created;
    }
  }

  /** Start the mail and return at once. A dropped send is logged, not thrown. */
  private deferLink(
    recipient: MailRecipient,
    token: string,
    requestId: string,
  ): void {
    this.mailDispatcher.dispatch(async () => {
      const sent = await this.authMailService.sendMagicLink(
        recipient,
        mailLink(this.configService, MAIL_NAME.MAGIC_LINK, recipient, {
          token,
        }),
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

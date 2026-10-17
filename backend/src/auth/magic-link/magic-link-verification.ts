import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiResponse } from '../../common/dto/api-response.dto';
import type { AppException } from '../../common/exceptions/app.exception';
import { requestLocaleOf } from '../../common/decorators/request-locale.decorator';
import { Clock } from '../../common/services/clock';
import { BrowserApplications } from '../../session/applications/browser-applications';
import type { BrowserApplicationId } from '../../session/applications/types/browser-application';
import { AudienceAdmissionRefused } from '../../session/utils/authority/audience-admission';
import { LoginResponseDto } from '../dto/login-response.dto';
import { SelfSignUpRefusedError } from '../services/registration/self-sign-up-refused.error';
import { MAGIC_LINK_CONFIRM_MESSAGE } from './constants/magic-link.constants';
import type { VerifyMagicLinkDto } from './dto/verify-magic-link.dto';
import type { MagicLinkAccountCreation } from './magic-link-account-creation';
import { MagicLinkBrowserService } from './magic-link-browser.service';
import { MagicLinkCeremonies } from './magic-link-ceremonies';
import type {
  MagicLinkAccount,
  MagicLinkAccounts,
  MagicLinkSignIn,
} from './stores/magic-link-accounts';
import type {
  MagicLinkStore,
  UnspentMagicLink,
} from './stores/magic-link.store';
import type { MagicLinkLoginResponseData } from './types/magic-link-login-response';
import { verifiedMagicLinkApplication } from './utils/magic-link-browser-context';
import { hashMagicLinkToken, sameHash } from './utils/magic-link-token.util';
import { maskEmail } from './utils/mask-email.util';

interface VerificationDependencies {
  links: MagicLinkStore;
  accounts: MagicLinkAccounts;
  signIn: MagicLinkSignIn;
  browser: MagicLinkBrowserService;
  ceremonies: MagicLinkCeremonies;
  applications: BrowserApplications;
  clock: Clock;
  accountCreation: MagicLinkAccountCreation;
  invalidLink(reason: string): AppException;
  deletedRefusal?(userId: string, failure: AppException): Promise<AppException>;
}

export class MagicLinkVerification {
  private readonly logger = new Logger('MagicLinkService');

  constructor(private readonly dependencies: VerificationDependencies) {}

  async verify(
    dto: VerifyMagicLinkDto,
    request: Request,
    response: Response,
  ): Promise<ApiResponse<MagicLinkLoginResponseData>> {
    const { applications, links, clock, signIn } = this.dependencies;
    await applications.resolve(request);
    const tokenHash = hashMagicLinkToken(dto.token);
    let claimedAt: Date | undefined;
    try {
      const candidate = await this.dependencies.ceremonies.pending(
        request,
        dto.token,
      );
      const pending =
        candidate && candidate.expiresAt.getTime() > clock.now().getTime()
          ? candidate
          : null;
      if (pending) {
        const application = await applications.remember(
          request,
          verifiedMagicLinkApplication(dto.token),
        );
        applications.assertEnabled(application);
        const existing = await this.dependencies.accounts.findByEmail(
          pending.email,
        );
        if (existing && !existing.isDeleted) {
          await signIn.assertAdmission(existing, response);
        }
      }
      if (dto.confirm !== true) {
        if (!pending) {
          throw this.dependencies.invalidLink(
            'token is unknown or already used',
          );
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

      const now = clock.now();
      const link = await links.claimLink(tokenHash, now);
      if (!link) {
        throw this.dependencies.invalidLink('token is unknown or already used');
      }
      claimedAt = now;
      if (link.expiresAt.getTime() <= clock.now().getTime()) {
        throw this.dependencies.invalidLink('token has expired');
      }
      const application = await applications.remember(
        request,
        verifiedMagicLinkApplication(dto.token),
      );
      applications.assertEnabled(application);
      const user = await this.resolveUser(
        link.email,
        request,
        response,
        application.clientId,
      );
      await signIn.assertAdmission(user, response);
      const outcome = await signIn.complete(user, response);
      this.dependencies.browser.release(response);

      let loginResponse: ApiResponse<LoginResponseDto>;
      if (outcome.requiresTwoFactor) {
        this.logger.log(`Link spent, second factor owed: userId=${user.id}`);
        loginResponse = LoginResponseDto.twoFactorRequired();
      } else {
        this.logger.log(`User signed in with a magic link: userId=${user.id}`);
        loginResponse = LoginResponseDto.success(outcome.user);
      }
      return ApiResponse.success(
        {
          ...loginResponse.data,
          ...(link.redirect ? { redirect: link.redirect } : {}),
        },
        loginResponse.message,
      );
    } catch (error) {
      if (error instanceof AudienceAdmissionRefused) {
        if (claimedAt) await links.restoreUnspentLink(tokenHash, claimedAt);
        throw this.dependencies.invalidLink('account audience is not admitted');
      }
      if (error instanceof SelfSignUpRefusedError) {
        await signIn.recordCreationRefusal(
          applications.current(request).clientId,
        );
        throw this.dependencies.invalidLink('self sign-up is closed');
      }
      throw error;
    }
  }

  private async resolveUser(
    email: string,
    request: Request,
    response: Response,
    clientId: BrowserApplicationId,
  ): Promise<MagicLinkAccount> {
    const { accounts, signIn } = this.dependencies;
    const existing = await accounts.findByEmail(email);
    if (existing?.isDeleted) {
      const failure = this.dependencies.invalidLink('account is deleted');
      throw (
        (await this.dependencies.deletedRefusal?.(existing.id, failure)) ??
        failure
      );
    }
    if (!existing) {
      return this.dependencies.accountCreation.createUser(
        email,
        requestLocaleOf(request),
        clientId,
      );
    }
    await signIn.assertAdmission(existing, response);
    if (!existing.isVerified) await accounts.markVerified(existing);
    return existing;
  }

  private async needsConfirmation(
    pending: UnspentMagicLink,
    request: Request,
  ): Promise<boolean> {
    const { browser, accounts } = this.dependencies;
    const presented = browser.presentedNonceHash(request);
    if (
      !presented ||
      !pending.requestNonceHash ||
      !sameHash(presented, pending.requestNonceHash)
    ) {
      return true;
    }
    const sessionAccountId = await browser.sessionAccountId(request);
    if (sessionAccountId === null) return false;
    return (await accounts.findByEmail(pending.email))?.id !== sessionAccountId;
  }
}

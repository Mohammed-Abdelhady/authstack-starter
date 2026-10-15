import { createProviderAccount } from './create-provider-account';
import { SelfSignUpRefusedError } from '../services/registration/self-sign-up-refused.error';
import { AudienceAdmissionRefused } from '../../session/utils/authority/audience-admission';
import { storeFailureCause } from '../../common/persistence/store-failure';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import {
  assertActive,
  assertEmailVerified,
  assertMayLinkByEmail,
  providerAuthenticationFailed,
} from './oauth-account-rules';
import { Clock } from '../../common/services/clock';
import { AddressLedger } from '../../common/persistence/address-ledger';
import { FIRST_FACTOR } from '../services/sessions/first-factor';
import {
  SignInCompletion,
  SignInOutcome,
} from '../services/sessions/sign-in-completion';
import { Sessions } from '../services/sessions/sessions';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import { StoredAccount } from '../../user/stores/stored-account';
import { ProfileSyncService } from '../../user/services/profile-sync.service';
import { AccountLinkingService } from '../../user/services/account-linking.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { toProviderLinkError } from './utils/provider-link-error.util';
import { readBearerToken } from '../../session/native/access/native-access.service';
import { hasBothCredentials } from '../../session/utils/request/request-credential';
import {
  OAuthProfile,
  OAuthProviderStrategy,
} from './oauth-provider.interface';
import { ProviderSignInStore } from './stores/provider-sign-in.store';
import {
  LinkingProvider,
  LinkingSession,
  OAuthLinkParams,
  OAuthLoginParams,
} from './types/oauth-service.types';
import { SecurityNoticeService } from '../../user/services/security-notice.service';
import { SECURITY_NOTICE } from '../../user/constants/security-notice.constants';
import {
  DEFAULT_LOCALE,
  SupportedLocale,
} from '../../common/constants/locales';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { WEB_CLIENT_ID } from '../../session/constants/client-ids';
import { AccountCreationPolicy } from '../services/registration/account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../constants/account-creation';

/**
 * Turns a provider authorization code into an application session.
 * Provider specifics stay in the strategies; this service only knows ids.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly accounts: ProviderSignInStore,
    private readonly signInService: SignInCompletion,
    private readonly profileSyncService: ProfileSyncService,
    private readonly accountLinkingService: AccountLinkingService,
    private readonly sessionService: Sessions,
    private readonly sessionCookieService: SessionCookieService,
    private readonly policy: AccountCreationPolicy,
    private readonly ledger: AddressLedger,
    private readonly clock: Clock,
    private readonly runner: UnitOfWorkRunner,
    private readonly notices?: SecurityNoticeService,
  ) {}

  /**
   * @returns whether a second factor is still owed, which the controller turns
   * into a redirect to the challenge page rather than to the client callback
   */
  async login(params: OAuthLoginParams): Promise<SignInOutcome> {
    try {
      const { strategy } = params;
      const profile = await this.loadVerifiedProfile(params);
      const user = await this.findOrCreateUser(
        strategy,
        profile,
        params.locale,
        params.clientId,
      );
      await this.profileSyncService.syncProfileFromProvider(
        user.id,
        strategy.id,
        profile,
      );

      const outcome = await this.signInService.completeSignIn(
        user,
        params.response,
        FIRST_FACTOR.PROVIDER,
      );

      this.logger.log(
        outcome.requiresTwoFactor
          ? `Second factor owed after ${strategy.id}`
          : `User authenticated through ${strategy.id}`,
      );
      return outcome;
    } catch (error) {
      if (error instanceof AudienceAdmissionRefused) {
        throw providerAuthenticationFailed(params.strategy.id);
      }
      throw error;
    }
  }

  /**
   * Attaches the provider identity to the account that started the link. The
   * callback is a navigation the provider's site started, and a browser sends
   * no `SameSite=Strict` cookie with it, so the session cookie cannot be asked
   * for here. The signed state names the account and the session that asked,
   * and that session must still be live. No session is issued and a second
   * factor is not started.
   */
  async link(params: OAuthLinkParams): Promise<void> {
    await this.assertLinkingSessionLive(params);

    const profile = await this.loadVerifiedProfile(params);
    await this.accountLinkingService.linkProvider(
      params.linkUserId,
      params.strategy.id,
      profile,
    );
    await this.profileSyncService.syncProfileFromProvider(
      params.linkUserId,
      params.strategy.id,
      profile,
    );
    this.logger.log(`Linked ${params.strategy.id} to the signed-in user`);
  }

  /**
   * The session that asked for the link is one of the account's live ones.
   * A session that was ended, has lapsed, or belongs to an account that was
   * deactivated since is not, and neither is a session of another account.
   */
  private async assertLinkingSessionLive(
    params: OAuthLinkParams,
  ): Promise<void> {
    const live = await this.sessionService.getUserSessions(params.linkUserId);
    if (
      live.some(
        (session) =>
          session.id === params.linkSessionId &&
          session.clientId === (params.clientId ?? WEB_CLIENT_ID),
      )
    ) {
      return;
    }
    throw new AppException(
      ErrorCode.SESSION_INVALID,
      'Invalid or expired session',
      HttpStatus.UNAUTHORIZED,
      { provider: params.strategy.id },
    );
  }

  async requireSessionUserId(request: Request): Promise<string> {
    return (await this.requireSession(request)).userId;
  }

  /** The signed-in session of a request, for the start of a link. */
  async requireSession(request: Request): Promise<LinkingSession> {
    if (
      hasBothCredentials(
        readBearerToken(request) !== null,
        this.sessionCookieService.read(request) !== undefined,
      )
    ) {
      throw new AppException(
        ErrorCode.MIXED_CREDENTIALS,
        'Send either the session cookie or an authorization credential',
        HttpStatus.BAD_REQUEST,
      );
    }
    const application =
      await this.sessionCookieService.applications.resolve(request);
    const token = this.sessionCookieService.read(request);
    if (!token) {
      throw new AppException(
        ErrorCode.SESSION_REQUIRED,
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const session = await this.sessionService.validateSession(token);
    const user = session?.user;
    if (
      !session ||
      !user ||
      user.isDeleted ||
      session.clientId !== application.clientId
    ) {
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Invalid or expired session',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return { userId: user.id, sessionId: session.id };
  }

  private async loadVerifiedProfile(
    params: OAuthLoginParams,
  ): Promise<OAuthProfile> {
    const tokens = await params.strategy.exchangeCode({
      code: params.code,
      redirectUri: params.redirectUri,
      codeVerifier: params.codeVerifier,
      nonce: params.nonce,
    });
    const profile = await params.strategy.fetchProfile(
      tokens,
      params.callbackParams,
    );
    assertEmailVerified(params.strategy, profile);
    return profile;
  }

  async resolveVerifiedProfile(
    strategy: OAuthProviderStrategy,
    profile: OAuthProfile,
    locale: SupportedLocale,
    application = WEB_CLIENT_ID,
  ): Promise<StoredAccount> {
    assertEmailVerified(strategy, profile);
    return this.findOrCreateUser(strategy, profile, locale, application);
  }

  /**
   * Resolves the account for a provider profile: existing link, existing email,
   * or a new user. The account email is never overwritten from the provider.
   * An account that has the address is only attached to when the provider
   * vouches for each address and this server verified the account's own.
   * A new account stores `locale`; without a request it is the default.
   */
  async findOrCreateUser(
    strategy: LinkingProvider,
    profile: OAuthProfile,
    locale: SupportedLocale = DEFAULT_LOCALE,
    application = WEB_CLIENT_ID,
  ): Promise<StoredAccount> {
    const provider = strategy.id;
    const identity = { provider, providerId: profile.providerId };
    const linked = await this.accounts.findByIdentity(identity);

    if (linked) {
      assertActive(linked, provider, this.logger);
      await this.sessionService.assertAdmission(linked.id, application);
      return linked;
    }

    const byEmail = await this.accounts.findByAddress(profile.email);
    if (byEmail) {
      assertActive(byEmail, provider, this.logger);
      await this.sessionService.assertAdmission(byEmail.id, application);
      assertMayLinkByEmail(strategy, byEmail, this.logger);
      return this.linkToExistingUser(byEmail, identity);
    }

    if (!strategy.autoLinksByEmail) {
      throw new AppException(
        ErrorCode.OAUTH_EMAIL_UNVERIFIED,
        'This provider cannot verify the email address. Sign in another way, then link the provider in settings',
        HttpStatus.FORBIDDEN,
        { provider },
      );
    }

    return this.createUser(identity, profile, locale, application);
  }

  private async linkToExistingUser(
    user: StoredAccount,
    identity: { provider: string; providerId: string },
  ): Promise<StoredAccount> {
    try {
      const linked = await this.accounts.linkFirstSignIn(user, identity);
      this.notices?.defer(linked.id, SECURITY_NOTICE.PROVIDER_ADDED);
      this.logger.log(
        `Linked ${identity.provider} account to an existing user`,
      );
      return linked;
    } catch (error) {
      throw toProviderLinkError(error, identity.provider);
    }
  }

  private async createUser(
    identity: { provider: string; providerId: string },
    profile: OAuthProfile,
    locale: SupportedLocale,
    application: string,
  ): Promise<StoredAccount> {
    try {
      const user = await createProviderAccount(
        {
          accounts: this.accounts,
          runner: this.runner,
          policy: this.policy,
          ledger: this.ledger,
          clock: this.clock,
        },
        identity,
        profile,
        locale,
        application,
      );

      this.logger.log(`Created a new user through ${identity.provider}`);
      return user;
    } catch (error) {
      if (storeFailureCause(error) instanceof SelfSignUpRefusedError) {
        await this.sessionService.recordCreationRefusal(
          application,
          ACCOUNT_CREATION_METHOD.PROVIDER,
        );
        throw providerAuthenticationFailed(identity.provider);
      }
      throw toProviderLinkError(error, identity.provider);
    }
  }
}

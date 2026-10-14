import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { FIRST_FACTOR } from '../services/sessions/first-factor'; // feature:totp
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
import { UniqueConflictError } from '../../common/persistence/persistence-errors';
import { storeFailureCause } from '../../common/persistence/store-failure';
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

const DEFAULT_ROLE = 'user';

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
    private readonly notices?: SecurityNoticeService,
  ) {}

  /**
   * @returns whether a second factor is still owed, which the controller turns
   * into a redirect to the challenge page rather than to the client callback
   */
  async login(params: OAuthLoginParams): Promise<SignInOutcome> {
    const { strategy } = params;
    const profile = await this.loadVerifiedProfile(params);
    const user = await this.findOrCreateUser(strategy, profile, params.locale);
    await this.profileSyncService.syncProfileFromProvider(
      user.id,
      strategy.id,
      profile,
    );

    const outcome = await this.signInService.completeSignIn(
      user,
      params.response,
      FIRST_FACTOR.PROVIDER, // feature:totp
    );

    this.logger.log(
      outcome.requiresTwoFactor
        ? `Second factor owed after ${strategy.id}`
        : `User authenticated through ${strategy.id}`,
    );
    return outcome;
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
    if (live.some((session) => session.id === params.linkSessionId)) {
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
    if (!session || !user || user.isDeleted) {
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
    this.assertEmailVerified(params.strategy, profile);
    return profile;
  }

  async resolveVerifiedProfile(
    strategy: OAuthProviderStrategy,
    profile: OAuthProfile,
    locale: SupportedLocale,
  ): Promise<StoredAccount> {
    this.assertEmailVerified(strategy, profile);
    return this.findOrCreateUser(strategy, profile, locale);
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
  ): Promise<StoredAccount> {
    const provider = strategy.id;
    const identity = { provider, providerId: profile.providerId };
    const linked = await this.accounts.findByIdentity(identity);

    if (linked) {
      this.assertActive(linked, provider);
      return linked;
    }

    const byEmail = await this.accounts.findByAddress(profile.email);
    if (byEmail) {
      this.assertActive(byEmail, provider);
      this.assertMayLinkByEmail(strategy, byEmail);
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

    return this.createUser(identity, profile, locale);
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
      throw this.toLinkConflict(error, identity.provider);
    }
  }

  private async createUser(
    identity: { provider: string; providerId: string },
    profile: OAuthProfile,
    locale: SupportedLocale,
  ): Promise<StoredAccount> {
    try {
      const user = await this.accounts.createFromProvider({
        ...identity,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        role: DEFAULT_ROLE,
        locale,
      });

      this.logger.log(`Created a new user through ${identity.provider}`);
      return user;
    } catch (error) {
      throw this.toLinkConflict(error, identity.provider);
    }
  }

  private assertEmailVerified(
    strategy: OAuthProviderStrategy,
    profile: OAuthProfile,
  ): void {
    if (profile.emailVerified || strategy.emailAlwaysVerified) {
      return;
    }

    throw new AppException(
      ErrorCode.OAUTH_EMAIL_UNVERIFIED,
      `The email address on this ${strategy.displayName} account is not verified`,
      HttpStatus.FORBIDDEN,
      { provider: strategy.id },
    );
  }

  /**
   * Attaching by address alone hands the account to whoever the provider says
   * owns the address. That is refused when the provider states nothing about
   * the address, and when the account's own address was never verified here,
   * because such an account may not belong to the address's owner.
   */
  private assertMayLinkByEmail(
    strategy: LinkingProvider,
    account: StoredAccount,
  ): void {
    if (strategy.autoLinksByEmail && account.isVerified) {
      return;
    }

    this.logger.warn(
      `First ${strategy.id} sign-in not attached to an existing account`,
    );
    throw new AppException(
      ErrorCode.OAUTH_ACCOUNT_EXISTS,
      'An account with this address already exists. Sign in another way, then link this provider in the settings',
      HttpStatus.CONFLICT,
      { provider: strategy.id },
    );
  }

  private assertActive(user: StoredAccount, provider: string): void {
    if (!user.isDeleted) {
      return;
    }

    this.logger.warn(
      `OAuth login rejected for a deleted account (${provider})`,
    );
    throw new AppException(
      ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      'OAuth authentication failed',
      HttpStatus.UNAUTHORIZED,
      { provider },
    );
  }

  private toLinkConflict(error: unknown, provider: string): unknown {
    if (!(error instanceof UniqueConflictError)) {
      return storeFailureCause(error);
    }

    return new AppException(
      ErrorCode.OAUTH_ACCOUNT_LINKED_ELSEWHERE,
      'This provider account is already linked to another user',
      HttpStatus.CONFLICT,
      { provider },
    );
  }
}

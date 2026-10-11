import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
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
  OAuthCallbackParams,
  OAuthProfile,
  OAuthProviderStrategy,
} from './oauth-provider.interface';
import { ProviderSignInStore } from './stores/provider-sign-in.store';

export interface OAuthLoginParams {
  strategy: OAuthProviderStrategy;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  nonce?: string;
  /** Raw callback parameters, for providers that ship profile data with them. */
  callbackParams?: OAuthCallbackParams;
  response: Response;
}

export interface OAuthLinkParams extends OAuthLoginParams {
  request: Request;
  linkUserId: string;
}

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
  ) {}

  /**
   * @returns whether a second factor is still owed, which the controller turns
   * into a redirect to the challenge page rather than to the client callback
   */
  async login(params: OAuthLoginParams): Promise<SignInOutcome> {
    const { strategy } = params;
    const profile = await this.loadVerifiedProfile(params);
    const user = await this.findOrCreateUser(strategy.id, profile);
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
   * Attaches the provider identity to the signed-in user. The existing
   * session is left alone; a second factor is not started.
   */
  async link(params: OAuthLinkParams): Promise<void> {
    const sessionUserId = await this.requireSessionUserId(params.request);
    if (sessionUserId !== params.linkUserId) {
      throw new AppException(
        ErrorCode.OAUTH_STATE_INVALID,
        'OAuth link intent does not match the signed-in user',
        HttpStatus.UNAUTHORIZED,
        { provider: params.strategy.id },
      );
    }

    const profile = await this.loadVerifiedProfile(params);
    await this.accountLinkingService.linkProvider(
      sessionUserId,
      params.strategy.id,
      profile,
    );
    await this.profileSyncService.syncProfileFromProvider(
      sessionUserId,
      params.strategy.id,
      profile,
    );
    this.logger.log(`Linked ${params.strategy.id} to the signed-in user`);
  }

  async requireSessionUserId(request: Request): Promise<string> {
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

    return user.id;
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

  /**
   * Resolves the account for a provider profile: existing link, existing email,
   * or a new user. The account email is never overwritten from the provider.
   */
  async findOrCreateUser(
    provider: string,
    profile: OAuthProfile,
  ): Promise<StoredAccount> {
    const identity = { provider, providerId: profile.providerId };
    const linked = await this.accounts.findByIdentity(identity);

    if (linked) {
      this.assertActive(linked, provider);
      return linked;
    }

    const byEmail = await this.accounts.findByAddress(profile.email);
    if (byEmail) {
      this.assertActive(byEmail, provider);
      return this.linkToExistingUser(byEmail, identity);
    }

    return this.createUser(identity, profile);
  }

  private async linkToExistingUser(
    user: StoredAccount,
    identity: { provider: string; providerId: string },
  ): Promise<StoredAccount> {
    try {
      const linked = await this.accounts.linkFirstSignIn(user, identity);
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
  ): Promise<StoredAccount> {
    try {
      const user = await this.accounts.createFromProvider({
        ...identity,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        role: DEFAULT_ROLE,
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

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthFailureReason } from '../oauth.constants';
import { BaseOAuthStrategy, joseCodeOf } from '../base-oauth.strategy';
import {
  AuthorizationUrlParams,
  ExchangeCodeParams,
  OAuthProfile,
  OAuthTokens,
} from '../oauth-provider.interface';
import { IdTokenClaims, verifyIdToken } from '../utils/id-token.util';

const DEFAULT_BASE_URL = 'https://gitlab.com';
const AUTH_PATH = '/oauth/authorize';
const TOKEN_PATH = '/oauth/token';
const USERINFO_PATH = '/oauth/userinfo';
const JWKS_PATH = '/oauth/discovery/keys';
const SCOPES = ['openid', 'profile', 'email', 'read_user'];

interface GitLabTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GitLabUserInfo {
  sub: string;
  name?: string;
  nickname?: string;
  preferred_username?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

/**
 * GitLab through its OpenID Connect endpoints, with PKCE and a verified
 * id_token.
 *
 * Every endpoint hangs off one root, so a self-managed instance only needs
 * OAUTH_GITLAB_BASE_URL. The issuer is that same root, which means a token
 * minted by gitlab.com is refused on an instance configured for another host.
 */
@Injectable()
export class GitLabOAuthStrategy extends BaseOAuthStrategy {
  readonly id = 'gitlab';
  readonly displayName = 'GitLab';
  readonly supportsPkce = true;
  readonly usesOidc = true;
  readonly emailAlwaysVerified = false;
  readonly autoLinksByEmail = true;

  constructor(configService: ConfigService) {
    super(configService);
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const { clientId } = this.credentials();
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state: params.state,
    });

    if (params.nonce) {
      query.set('nonce', params.nonce);
    }
    if (params.codeChallenge) {
      query.set('code_challenge', params.codeChallenge);
      query.set('code_challenge_method', 'S256');
    }

    return `${this.instanceUrl(AUTH_PATH)}?${query.toString()}`;
  }

  async exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    const { clientId, clientSecret } = this.credentials();
    const body: Record<string, string> = {
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    };
    if (params.codeVerifier) {
      body.code_verifier = params.codeVerifier;
    }

    const response = await this.httpPostForm<GitLabTokenResponse>(
      this.instanceUrl(TOKEN_PATH),
      body,
    );

    if (response.error || !response.access_token) {
      throw response.error
        ? this.codeExchangeFailed(OAuthFailureReason.PROVIDER_ERROR, {
            providerCode: response.error,
          })
        : this.codeExchangeFailed(OAuthFailureReason.NO_ACCESS_TOKEN);
    }
    if (!response.id_token) {
      throw this.codeExchangeFailed(OAuthFailureReason.NO_ID_TOKEN);
    }

    await this.verifyClaims(response.id_token, params.nonce);

    return {
      accessToken: response.access_token,
      idToken: response.id_token,
      refreshToken: response.refresh_token,
      expiresIn: response.expires_in,
      scope: response.scope,
      tokenType: response.token_type,
    };
  }

  async fetchProfile(tokens: OAuthTokens): Promise<OAuthProfile> {
    if (!tokens.idToken) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_ID_TOKEN);
    }

    const claims = await this.verifyClaims(tokens.idToken);
    const userInfo = await this.httpGetJson<GitLabUserInfo>(
      this.instanceUrl(USERINFO_PATH),
      { Authorization: `Bearer ${tokens.accessToken}` },
    );

    const email = userInfo.email ?? claims.email;
    if (!email) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_EMAIL);
    }

    return {
      providerId: claims.sub,
      email,
      emailVerified: this.isEmailVerified(userInfo, claims),
      name: userInfo.name ?? userInfo.nickname ?? email,
      avatarUrl: userInfo.picture,
    };
  }

  /**
   * GitLab only hands out an address the account has confirmed, but it does
   * send `email_verified` on both userinfo and the id_token. The explicit flag
   * wins where it is present.
   */
  private isEmailVerified(
    userInfo: GitLabUserInfo,
    claims: IdTokenClaims,
  ): boolean {
    if (typeof userInfo.email_verified === 'boolean') {
      return userInfo.email_verified;
    }
    return claims.email_verified === true || claims.email_verified === 'true';
  }

  private async verifyClaims(
    idToken: string,
    nonce?: string,
  ): Promise<IdTokenClaims> {
    const { clientId } = this.credentials();

    try {
      return await verifyIdToken({
        idToken,
        jwksUri: this.instanceUrl(JWKS_PATH),
        issuers: [this.baseUrl()],
        audience: clientId,
        nonce,
      });
    } catch (error) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN, {
        joseCode: joseCodeOf(error),
      });
    }
  }

  private instanceUrl(path: string): string {
    return `${this.baseUrl()}${path}`;
  }

  /** Root of the instance, without a trailing slash. */
  private baseUrl(): string {
    const configured = this.providerConfig?.extra.BASE_URL ?? DEFAULT_BASE_URL;
    return configured.replace(/\/$/, '');
  }
}

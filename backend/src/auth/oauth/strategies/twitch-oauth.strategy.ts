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

const AUTH_URL = 'https://id.twitch.tv/oauth2/authorize';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const USERINFO_URL = 'https://id.twitch.tv/oauth2/userinfo';
const JWKS_URI = 'https://id.twitch.tv/oauth2/keys';
const ISSUERS = ['https://id.twitch.tv/oauth2'];
const SCOPES = ['openid', 'user:read:email'];

/**
 * Twitch leaves email, its verification flag, the login name and the avatar out
 * of both the id_token and userinfo unless they are asked for by name.
 */
const CLAIMS_REQUEST = JSON.stringify({
  userinfo: {
    email: null,
    email_verified: null,
    preferred_username: null,
    picture: null,
  },
});

interface TwitchTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string | string[];
  token_type?: string;
  id_token?: string;
  error?: string;
  message?: string;
}

interface TwitchUserInfo {
  sub: string;
  preferred_username?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

/**
 * Twitch OpenID Connect.
 *
 * No PKCE: the authorize endpoint takes no code challenge, so the signed state
 * cookie and the id_token nonce carry the CSRF defence on their own. Scope
 * `user:read:email` is what makes the email claim available at all; the
 * `claims` parameter is what makes Twitch return it.
 */
@Injectable()
export class TwitchOAuthStrategy extends BaseOAuthStrategy {
  readonly id = 'twitch';
  readonly displayName = 'Twitch';
  readonly supportsPkce = false;
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
      claims: CLAIMS_REQUEST,
    });

    if (params.nonce) {
      query.set('nonce', params.nonce);
    }

    return `${AUTH_URL}?${query.toString()}`;
  }

  async exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    const { clientId, clientSecret } = this.credentials();
    const response = await this.httpPostForm<TwitchTokenResponse>(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    });

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
      scope: Array.isArray(response.scope)
        ? response.scope.join(' ')
        : response.scope,
      tokenType: response.token_type,
    };
  }

  async fetchProfile(tokens: OAuthTokens): Promise<OAuthProfile> {
    if (!tokens.idToken) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_ID_TOKEN);
    }

    const claims = await this.verifyClaims(tokens.idToken);
    const userInfo = await this.httpGetJson<TwitchUserInfo>(USERINFO_URL, {
      Authorization: `Bearer ${tokens.accessToken}`,
    });

    const email = userInfo.email ?? claims.email;
    if (!email) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_EMAIL);
    }

    return {
      providerId: claims.sub,
      email,
      emailVerified: this.isEmailVerified(userInfo, claims),
      name: userInfo.preferred_username ?? claims.name ?? email,
      avatarUrl: userInfo.picture,
    };
  }

  private isEmailVerified(
    userInfo: TwitchUserInfo,
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
        jwksUri: JWKS_URI,
        issuers: ISSUERS,
        audience: clientId,
        nonce,
      });
    } catch (error) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN, {
        joseCode: joseCodeOf(error),
      });
    }
  }
}

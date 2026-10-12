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
import { verifyIdToken } from '../utils/id-token.util';

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const JWKS_URI = 'https://www.linkedin.com/oauth/openid/jwks';
const ISSUERS = ['https://www.linkedin.com/oauth'];
const SCOPES = ['openid', 'profile', 'email'];

interface LinkedInTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface LinkedInUserInfo {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

/**
 * LinkedIn through "Sign In with LinkedIn using OpenID Connect".
 *
 * The id_token is verified, but LinkedIn's authorization request takes no
 * nonce, so `usesOidc` stays false: there is no nonce to bind and requesting
 * one would only fail the check. State and the exact redirect URI are the CSRF
 * defence. LinkedIn does not support PKCE.
 */
@Injectable()
export class LinkedInOAuthStrategy extends BaseOAuthStrategy {
  readonly id = 'linkedin';
  readonly displayName = 'LinkedIn';
  readonly supportsPkce = false;
  readonly usesOidc = false;
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

    return `${AUTH_URL}?${query.toString()}`;
  }

  async exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    const { clientId, clientSecret } = this.credentials();
    const response = await this.httpPostForm<LinkedInTokenResponse>(TOKEN_URL, {
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

    await this.verifySubject(response.id_token);

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

    const subject = await this.verifySubject(tokens.idToken);
    const userInfo = await this.httpGetJson<LinkedInUserInfo>(USERINFO_URL, {
      Authorization: `Bearer ${tokens.accessToken}`,
    });

    if (!userInfo.email) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_EMAIL);
    }

    return {
      providerId: subject,
      email: userInfo.email,
      emailVerified: userInfo.email_verified === true,
      name: userInfo.name ?? userInfo.given_name ?? userInfo.email,
      avatarUrl: userInfo.picture,
    };
  }

  /** Verifies the id_token and returns its `sub`, which is the provider id. */
  private async verifySubject(idToken: string): Promise<string> {
    const { clientId } = this.credentials();

    try {
      const claims = await verifyIdToken({
        idToken,
        jwksUri: JWKS_URI,
        issuers: ISSUERS,
        audience: clientId,
      });
      return claims.sub;
    } catch (error) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN, {
        joseCode: joseCodeOf(error),
      });
    }
  }
}

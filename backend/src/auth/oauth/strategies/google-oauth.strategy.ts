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
import type { NativeProviderProof } from '../types/native-provider';
import {
  nativeProfileFromClaims,
  verifyNativeIdToken,
} from '../utils/native-id-token.util';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SCOPES = ['openid', 'email', 'profile'];

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  picture?: string;
}

/** Google OpenID Connect, with PKCE and id_token verification. */
@Injectable()
export class GoogleOAuthStrategy extends BaseOAuthStrategy {
  readonly id = 'google';
  readonly displayName = 'Google';
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

    return `${AUTH_URL}?${query.toString()}`;
  }

  async exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    const { clientId, clientSecret } = this.credentials();
    const body: Record<string, string> = {
      code: params.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    };
    if (params.codeVerifier) {
      body.code_verifier = params.codeVerifier;
    }

    const response = await this.httpPostForm<GoogleTokenResponse>(
      TOKEN_URL,
      body,
    );

    if (response.error || !response.access_token) {
      throw response.error
        ? this.codeExchangeFailed(OAuthFailureReason.PROVIDER_ERROR, {
            providerCode: response.error,
          })
        : this.codeExchangeFailed(OAuthFailureReason.NO_ACCESS_TOKEN);
    }

    if (response.id_token) {
      await this.verifyIdentityToken(response.id_token, clientId, params.nonce);
    }

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
    const profile = await this.httpGetJson<GoogleUserInfo>(USERINFO_URL, {
      Authorization: `Bearer ${tokens.accessToken}`,
    });

    if (!profile.email) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_EMAIL);
    }

    return {
      providerId: profile.sub,
      email: profile.email,
      emailVerified: profile.email_verified === true,
      name: profile.name ?? profile.given_name ?? profile.email,
      avatarUrl: profile.picture,
    };
  }

  async verifyNativeCredential(
    proof: NativeProviderProof,
  ): Promise<OAuthProfile> {
    if (
      proof.credential.kind !== 'googleIdentityToken' ||
      proof.method.mode !== 'googleIdentityToken'
    ) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN);
    }
    try {
      const claims = await verifyNativeIdToken({
        idToken: proof.credential.identityToken,
        jwksUri: JWKS_URI,
        issuers: ISSUERS,
        audience: proof.method.sdk.webClientId,
        nonce: proof.nonceDigest,
      });
      return nativeProfileFromClaims(claims, claims.email_verified === true);
    } catch (error) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN, {
        joseCode: joseCodeOf(error),
      });
    }
  }

  private async verifyIdentityToken(
    idToken: string,
    audience: string,
    nonce?: string,
  ): Promise<void> {
    try {
      await verifyIdToken({
        idToken,
        jwksUri: JWKS_URI,
        issuers: ISSUERS,
        audience,
        nonce,
      });
    } catch (error) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN, {
        joseCode: joseCodeOf(error),
      });
    }
  }
}

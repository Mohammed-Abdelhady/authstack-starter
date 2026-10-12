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

const AUTH_URL =
  'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize';
const TOKEN_URL =
  'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token';
const USERINFO_URL = 'https://graph.microsoft.com/oidc/userinfo';
const JWKS_URI =
  'https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys';
const ISSUER_TEMPLATE = 'https://login.microsoftonline.com/{tid}/v2.0';
const DEFAULT_TENANT = 'common';
const SCOPES = ['openid', 'profile', 'email'];

interface MicrosoftTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface MicrosoftIdTokenClaims extends IdTokenClaims {
  /** Immutable object id of the user inside the tenant. */
  oid?: string;
  preferred_username?: string;
  /** Entra ID email verification flag, present when the tenant opts in. */
  xms_edov?: boolean | string;
}

interface MicrosoftUserInfo {
  sub: string;
  name?: string;
  email?: string;
  /** Graph URL that needs a bearer token, so it is not usable as an avatar. */
  picture?: string;
}

/**
 * Microsoft Entra ID, with PKCE and id_token verification.
 *
 * The issuer carries the tenant id, so it is checked against a template that
 * the token's own `tid` claim fills in. Set OAUTH_MICROSOFT_TENANT to a tenant
 * id to keep sign-in inside one organisation.
 */
@Injectable()
export class MicrosoftOAuthStrategy extends BaseOAuthStrategy {
  readonly id = 'microsoft';
  readonly displayName = 'Microsoft';
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
      response_mode: 'query',
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

    return `${this.tenantUrl(AUTH_URL)}?${query.toString()}`;
  }

  async exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    const { clientId, clientSecret } = this.credentials();
    const body: Record<string, string> = {
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPES.join(' '),
    };
    if (params.codeVerifier) {
      body.code_verifier = params.codeVerifier;
    }

    const response = await this.httpPostForm<MicrosoftTokenResponse>(
      this.tenantUrl(TOKEN_URL),
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
    const userInfo = await this.httpGetJson<MicrosoftUserInfo>(USERINFO_URL, {
      Authorization: `Bearer ${tokens.accessToken}`,
    });

    const email = userInfo.email ?? claims.email;
    if (!email) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_EMAIL);
    }

    return {
      providerId: claims.oid ?? claims.sub,
      email,
      emailVerified: this.isEmailVerified(claims, email),
      name: userInfo.name ?? claims.name ?? email,
    };
  }

  /**
   * Entra ID does not promise that `email` was verified. It counts as verified
   * when the tenant sends `xms_edov`, or when the address the user signs in
   * with is the same address, which means the directory owns it.
   */
  private isEmailVerified(
    claims: MicrosoftIdTokenClaims,
    email: string,
  ): boolean {
    if (claims.xms_edov === true || claims.xms_edov === 'true') {
      return true;
    }

    const signInName = claims.preferred_username;
    return (
      typeof signInName === 'string' &&
      signInName.includes('@') &&
      signInName.toLowerCase() === email.toLowerCase()
    );
  }

  private async verifyClaims(
    idToken: string,
    nonce?: string,
  ): Promise<MicrosoftIdTokenClaims> {
    const { clientId } = this.credentials();

    try {
      return await verifyIdToken({
        idToken,
        jwksUri: this.tenantUrl(JWKS_URI),
        issuerTemplate: ISSUER_TEMPLATE,
        audience: clientId,
        nonce,
      });
    } catch (error) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN, {
        joseCode: joseCodeOf(error),
      });
    }
  }

  private tenantUrl(template: string): string {
    return template.replace('{tenant}', this.tenant());
  }

  private tenant(): string {
    return this.providerConfig?.extra.TENANT ?? DEFAULT_TENANT;
  }
}

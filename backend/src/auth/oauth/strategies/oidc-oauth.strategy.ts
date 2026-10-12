import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthFailureReason } from '../oauth.constants';
import { describeDriverError } from '../../../common/utils/describe-error.util';
import { GENERIC_OIDC_PROVIDER } from '../../../common/constants/oauth-providers';
import { OAuthProviderConfig } from '../../../config/oauth.config';
import { BaseOAuthStrategy, joseCodeOf } from '../base-oauth.strategy';
import {
  AuthorizationUrlParams,
  ExchangeCodeParams,
  OAuthProfile,
  OAuthTokens,
} from '../oauth-provider.interface';
import { IdTokenClaims, verifyIdToken } from '../utils/id-token.util';
import {
  DiscoveryFailure,
  OidcEndpoints,
  discoverEndpoints,
  resolveManualEndpoints,
} from '../utils/oidc-discovery.util';
import { OidcSettings, readOidcSettings } from '../utils/oidc-settings.util';

interface OidcTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface OidcUserInfo {
  sub: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

/**
 * Any OpenID Connect issuer, configured through OAUTH_OIDC_* alone.
 *
 * Endpoints come from the issuer's discovery document, read once at startup and
 * held for the life of the process. An unreachable issuer leaves the provider
 * off rather than stopping the boot, so one broken identity provider does not
 * take the application down with it. Setting all four endpoint variables skips
 * discovery entirely.
 */
@Injectable()
export class OidcOAuthStrategy
  extends BaseOAuthStrategy
  implements OnModuleInit
{
  readonly id: string;
  readonly displayName: string;
  readonly usesOidc = true;
  readonly emailAlwaysVerified = false;
  readonly autoLinksByEmail = true;

  private readonly settings: OidcSettings;
  private endpoints?: OidcEndpoints;

  constructor(configService: ConfigService) {
    super(configService);

    this.settings = readOidcSettings(
      configService.get<OAuthProviderConfig>(
        `oauth.providers.${GENERIC_OIDC_PROVIDER}`,
      ),
    );
    this.id = this.settings.providerId;
    this.displayName = this.settings.displayName;
    this.endpoints = this.settings.issuer
      ? resolveManualEndpoints(this.settings.issuer, this.settings.overrides)
      : undefined;
  }

  /** The environment prefix stays OAUTH_OIDC whatever the provider is called. */
  get envPrefix(): string {
    return `OAUTH_${GENERIC_OIDC_PROVIDER.toUpperCase()}`;
  }

  /** Only sent once the discovery document says the issuer accepts it. */
  get supportsPkce(): boolean {
    return this.endpoints?.supportsPkceS256 === true;
  }

  /**
   * Configuration is read under `oidc` even when the provider is served under
   * another id, so both spellings reach the same OAUTH_OIDC_* variables.
   */
  protected get providerConfig(): OAuthProviderConfig | undefined {
    return this.configService.get<OAuthProviderConfig>(
      `oauth.providers.${GENERIC_OIDC_PROVIDER}`,
    );
  }

  async onModuleInit(): Promise<void> {
    if (this.endpoints || !this.settings.hasCredentials) {
      return;
    }

    const { issuer } = this.settings;
    if (!issuer) {
      this.logger.warn(
        'OAUTH_OIDC_ISSUER is not set, so the provider stays disabled',
      );
      return;
    }

    try {
      this.endpoints = await discoverEndpoints(issuer, this.settings.overrides);
      this.logger.log(
        `Read the OpenID Connect discovery document of ${issuer}`,
      );
    } catch (error) {
      // The discovery failure's closed reason and status go to the log; its
      // message can quote a document a third party published.
      const facts =
        error instanceof DiscoveryFailure
          ? `reason=${error.reason}${
              error.httpStatus === undefined
                ? ''
                : ` status=${error.httpStatus}`
            }`
          : `reason=${OAuthFailureReason.UNEXPECTED}`;
      this.logger.warn(
        `Discovery failed for '${this.id}': ${describeDriverError(error)} ${facts}`,
      );
    }
  }

  isEnabled(): boolean {
    return this.settings.hasCredentials && this.endpoints !== undefined;
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const { clientId } = this.credentials();
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: this.settings.scopes,
      state: params.state,
    });

    if (params.nonce) {
      query.set('nonce', params.nonce);
    }
    if (params.codeChallenge) {
      query.set('code_challenge', params.codeChallenge);
      query.set('code_challenge_method', 'S256');
    }

    return `${this.resolved().authorizationUrl}?${query.toString()}`;
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

    const response = await this.httpPostForm<OidcTokenResponse>(
      this.resolved().tokenUrl,
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
    const userInfo = await this.httpGetJson<OidcUserInfo>(
      this.resolved().userInfoUrl,
      { Authorization: `Bearer ${tokens.accessToken}` },
    );

    if (userInfo.sub !== claims.sub) {
      throw this.profileFetchFailed(OAuthFailureReason.SUBJECT_MISMATCH);
    }

    const email = userInfo.email ?? claims.email;
    if (!email) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_EMAIL);
    }

    return {
      providerId: claims.sub,
      email,
      emailVerified: isEmailVerified(userInfo, claims),
      name:
        userInfo.name ?? userInfo.preferred_username ?? claims.name ?? email,
      avatarUrl: userInfo.picture,
    };
  }

  private async verifyClaims(
    idToken: string,
    nonce?: string,
  ): Promise<IdTokenClaims> {
    const { clientId } = this.credentials();
    const endpoints = this.resolved();

    try {
      return await verifyIdToken({
        idToken,
        jwksUri: endpoints.jwksUri,
        issuers: [endpoints.issuer],
        audience: clientId,
        algorithms: endpoints.signingAlgorithms,
        nonce,
      });
    } catch (error) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN, {
        joseCode: joseCodeOf(error),
      });
    }
  }

  /**
   * @throws Error when discovery never succeeded. Routes are only reachable
   * through the registry, which turns an unconfigured provider away first.
   */
  private resolved(): OidcEndpoints {
    if (!this.endpoints) {
      throw new Error(
        `OAuth provider '${this.id}' has no resolved OpenID Connect endpoints`,
      );
    }
    return this.endpoints;
  }
}

function isEmailVerified(
  userInfo: OidcUserInfo,
  claims: IdTokenClaims,
): boolean {
  if (typeof userInfo.email_verified === 'boolean') {
    return userInfo.email_verified;
  }
  return claims.email_verified === true || claims.email_verified === 'true';
}

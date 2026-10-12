import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthFailureReason } from '../oauth.constants';
import { BaseOAuthStrategy } from '../base-oauth.strategy';
import {
  AuthorizationUrlParams,
  ExchangeCodeParams,
  OAuthProfile,
  OAuthTokens,
} from '../oauth-provider.interface';

const AUTH_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const USER_EMAILS_URL = 'https://api.github.com/user/emails';
const GITHUB_OAUTH_ERROR_CODES = [
  'incorrect_client_credentials',
  'redirect_uri_mismatch',
  'bad_verification_code',
  'unverified_user_email',
] as const;
const SCOPES = ['read:user', 'user:email'];
const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

interface GitHubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * GitHub OAuth 2.0. No OIDC id_token and no PKCE support, so the signed state
 * cookie is the only CSRF defence here.
 */
@Injectable()
export class GitHubOAuthStrategy extends BaseOAuthStrategy {
  protected readonly providerErrorCodes = GITHUB_OAUTH_ERROR_CODES;
  readonly id = 'github';
  readonly displayName = 'GitHub';
  readonly supportsPkce = false;
  readonly usesOidc = false;
  readonly emailAlwaysVerified = true;
  // Only an address the emails API marks verified is ever returned.
  readonly autoLinksByEmail = true;

  constructor(configService: ConfigService) {
    super(configService);
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const { clientId } = this.credentials();
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: params.redirectUri,
      scope: SCOPES.join(' '),
      state: params.state,
    });

    return `${AUTH_URL}?${query.toString()}`;
  }

  async exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    const { clientId, clientSecret } = this.credentials();
    const response = await this.httpPostForm<GitHubTokenResponse>(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    });

    if (response.error || !response.access_token) {
      throw response.error
        ? this.codeExchangeFailed(OAuthFailureReason.PROVIDER_ERROR, {
            providerCode: response.error,
          })
        : this.codeExchangeFailed(OAuthFailureReason.NO_ACCESS_TOKEN);
    }

    return {
      accessToken: response.access_token,
      scope: response.scope,
      tokenType: response.token_type,
    };
  }

  async fetchProfile(tokens: OAuthTokens): Promise<OAuthProfile> {
    const headers = {
      ...API_HEADERS,
      Authorization: `Bearer ${tokens.accessToken}`,
    };

    const user = await this.httpGetJson<GitHubUser>(USER_URL, headers);
    const email = await this.primaryVerifiedEmail(headers);

    if (!email) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_EMAIL);
    }

    return {
      providerId: user.id.toString(),
      email,
      emailVerified: true,
      name: user.name ?? user.login,
      avatarUrl: user.avatar_url ?? undefined,
    };
  }

  private async primaryVerifiedEmail(
    headers: Record<string, string>,
  ): Promise<string | undefined> {
    const emails = await this.httpGetJson<GitHubEmail[]>(
      USER_EMAILS_URL,
      headers,
    );

    const primary = emails.find((entry) => entry.primary && entry.verified);
    if (primary) {
      return primary.email;
    }

    return emails.find((entry) => entry.verified)?.email;
  }
}

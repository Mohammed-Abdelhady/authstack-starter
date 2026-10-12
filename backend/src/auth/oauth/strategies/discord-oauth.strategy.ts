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

const AUTH_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';
const AVATAR_URL = 'https://cdn.discordapp.com/avatars';
const SCOPES = ['identify', 'email'];

interface DiscordTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  email?: string | null;
  verified?: boolean;
  avatar?: string | null;
}

/**
 * Discord OAuth 2.0 with PKCE. No id_token, so the signed state cookie and the
 * PKCE verifier carry the CSRF and code interception defence.
 */
@Injectable()
export class DiscordOAuthStrategy extends BaseOAuthStrategy {
  readonly id = 'discord';
  readonly displayName = 'Discord';
  readonly supportsPkce = true;
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

    if (params.codeChallenge) {
      query.set('code_challenge', params.codeChallenge);
      query.set('code_challenge_method', 'S256');
    }

    return `${AUTH_URL}?${query.toString()}`;
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

    const response = await this.httpPostForm<DiscordTokenResponse>(
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

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresIn: response.expires_in,
      scope: response.scope,
      tokenType: response.token_type,
    };
  }

  async fetchProfile(tokens: OAuthTokens): Promise<OAuthProfile> {
    const user = await this.httpGetJson<DiscordUser>(USER_URL, {
      Authorization: `Bearer ${tokens.accessToken}`,
    });

    // Discord returns email: null for accounts that never confirmed an address.
    if (!user.email) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_EMAIL);
    }

    return {
      providerId: user.id,
      email: user.email,
      emailVerified: user.verified === true,
      name: user.global_name ?? user.username,
      avatarUrl: this.avatarUrl(user),
    };
  }

  private avatarUrl(user: DiscordUser): string | undefined {
    if (!user.avatar) {
      return undefined;
    }
    return `${AVATAR_URL}/${user.id}/${user.avatar}.png`;
  }
}

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

const GRAPH_VERSION = 'v18.0';
const AUTH_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const TOKEN_URL = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`;
const USER_URL = `https://graph.facebook.com/${GRAPH_VERSION}/me`;
const PROFILE_FIELDS = 'id,name,email,picture.type(large)';
const SCOPES = ['email', 'public_profile'];

interface FacebookTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message: string; type: string; code: number };
}

interface FacebookUser {
  id: string;
  name?: string;
  email?: string;
  picture?: { data?: { url?: string } };
  error?: { message: string };
}

/**
 * Facebook Login through the Graph API. The Graph API exposes no email
 * verification flag, so addresses it returns are treated as verified.
 */
@Injectable()
export class FacebookOAuthStrategy extends BaseOAuthStrategy {
  readonly id = 'facebook';
  readonly displayName = 'Facebook';
  readonly supportsPkce = false;
  readonly usesOidc = false;
  readonly emailAlwaysVerified = true;
  // The Graph API states nothing about the address, so it is not proof enough.
  readonly autoLinksByEmail = false;

  constructor(configService: ConfigService) {
    super(configService);
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const { clientId } = this.credentials();
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(','),
      state: params.state,
    });

    return `${AUTH_URL}?${query.toString()}`;
  }

  async exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    const { clientId, clientSecret } = this.credentials();
    const response = await this.httpPostForm<FacebookTokenResponse>(TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: params.redirectUri,
      code: params.code,
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
      expiresIn: response.expires_in,
      tokenType: response.token_type,
    };
  }

  async fetchProfile(tokens: OAuthTokens): Promise<OAuthProfile> {
    const query = new URLSearchParams({ fields: PROFILE_FIELDS });
    const user = await this.httpGetJson<FacebookUser>(
      `${USER_URL}?${query.toString()}`,
      { Authorization: `Bearer ${tokens.accessToken}` },
    );

    if (user.error) {
      // Facebook's graph error is free text and a numeric code; neither is loggable.
      throw this.profileFetchFailed(OAuthFailureReason.PROVIDER_ERROR);
    }
    if (!user.email) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_EMAIL);
    }

    return {
      providerId: user.id,
      email: user.email,
      emailVerified: true,
      name: user.name ?? user.email,
      avatarUrl: user.picture?.data?.url,
    };
  }
}

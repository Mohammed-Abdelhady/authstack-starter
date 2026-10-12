import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthFailureReason } from '../oauth.constants';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { BaseOAuthStrategy } from '../base-oauth.strategy';
import {
  AuthorizationUrlParams,
  ExchangeCodeParams,
  OAuthProfile,
  OAuthTokens,
} from '../oauth-provider.interface';

const AUTH_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const USER_URL = 'https://api.x.com/2/users/me';
const USER_FIELDS = 'confirmed_email,profile_image_url';
const SCOPES = [
  'tweet.read',
  'users.read',
  // The address only comes back with this scope, and it needs review on the app.
  'users.email',
  'offline.access',
];

interface XTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface XUser {
  id: string;
  name?: string;
  username?: string;
  confirmed_email?: string;
  profile_image_url?: string;
}

/** Every v2 endpoint wraps its payload in `data`. */
interface XUserResponse {
  data?: XUser;
  title?: string;
  detail?: string;
}

/**
 * X OAuth 2.0. No OpenID Connect, so there is no id_token and no nonce.
 *
 * PKCE is mandatory rather than optional here, and the token endpoint wants the
 * client id and secret as HTTP Basic credentials on top of the verifier.
 * Authorization codes live for 30 seconds, so the exchange has to run inside
 * the callback request; nothing may be queued or retried later.
 */
@Injectable()
export class XOAuthStrategy extends BaseOAuthStrategy {
  readonly id = 'x';
  readonly displayName = 'X';
  readonly supportsPkce = true;
  readonly usesOidc = false;
  readonly emailAlwaysVerified = false;
  readonly autoLinksByEmail = true;

  constructor(configService: ConfigService) {
    super(configService);
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    if (!params.codeChallenge) {
      throw this.pkceRequired();
    }

    const { clientId } = this.credentials();
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${AUTH_URL}?${query.toString()}`;
  }

  async exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    if (!params.codeVerifier) {
      throw this.pkceRequired();
    }

    const { clientId, clientSecret } = this.credentials();
    // The client identifies itself in the Authorization header, so the body
    // carries no client_id and no client_secret.
    const response = await this.httpPostForm<XTokenResponse>(
      TOKEN_URL,
      {
        code: params.code,
        redirect_uri: params.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: params.codeVerifier,
      },
      { Authorization: this.basicAuthorization(clientId, clientSecret) },
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
    const response = await this.httpGetJson<XUserResponse>(
      `${USER_URL}?user.fields=${encodeURIComponent(USER_FIELDS)}`,
      { Authorization: `Bearer ${tokens.accessToken}` },
    );

    const user = response.data;
    if (!user) {
      // X's `detail` is free text; the log carries the closed reason only.
      throw this.profileFetchFailed(OAuthFailureReason.PROVIDER_ERROR);
    }

    // X hands out confirmed_email only for an address the account confirmed, so
    // its absence means there is nothing to trust rather than nothing to read.
    if (!user.confirmed_email) {
      throw this.emailUnverified();
    }

    return {
      providerId: user.id,
      email: user.confirmed_email,
      emailVerified: true,
      name: user.name ?? user.username ?? user.confirmed_email,
      avatarUrl: user.profile_image_url,
    };
  }

  private basicAuthorization(clientId: string, clientSecret: string): string {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      'base64',
    );
    return `Basic ${credentials}`;
  }

  private pkceRequired(): AppException {
    this.logger.warn('X flow reached the exchange without a PKCE verifier');
    return new AppException(
      ErrorCode.OAUTH_STATE_INVALID,
      'X requires PKCE and the flow carried no code verifier',
      HttpStatus.BAD_REQUEST,
      { provider: this.id },
    );
  }

  private emailUnverified(): AppException {
    return new AppException(
      ErrorCode.OAUTH_EMAIL_UNVERIFIED,
      'This X account has no confirmed email address',
      HttpStatus.FORBIDDEN,
      { provider: this.id },
    );
  }
}

import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAUTH_HTTP_TIMEOUT_MS, OAuthFailureReason } from '../oauth.constants';
import { REVOCATION_FAILURE } from '../provider-tokens/constants/provider-tokens.constants';
import type {
  RevocableProvider,
  RevocationAttempt,
} from '../provider-tokens/revocable-provider';
import { ProviderTokenVault } from '../provider-tokens/services/provider-token-vault';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { BaseOAuthStrategy, joseCodeOf } from '../base-oauth.strategy';
import {
  AuthorizationUrlParams,
  ExchangeCodeParams,
  OAuthCallbackMethod,
  OAuthCallbackParams,
  OAuthProfile,
  OAuthTokens,
} from '../oauth-provider.interface';
import { IdTokenClaims, verifyIdToken } from '../utils/id-token.util';
import { createAppleClientSecret } from '../utils/apple-client-secret.util';
import { readAppleUserName } from '../utils/apple-user-payload.util';
import type { NativeProviderProof } from '../types/native-provider';
import {
  nativeProfileFromClaims,
  verifyNativeIdToken,
} from '../utils/native-id-token.util';

const AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const JWKS_URI = 'https://appleid.apple.com/auth/keys';
/** Apple's answer for a token that no longer grants anything. */
const ALREADY_INVALID = 'invalid_grant';
const ISSUERS = ['https://appleid.apple.com'];
const SCOPES = ['name', 'email'];

interface AppleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface AppleIdTokenClaims extends IdTokenClaims {
  /** Apple sends booleans as strings on some releases. */
  is_private_email?: boolean | string;
}

interface AppleSigningKey {
  teamId: string;
  keyId: string;
  privateKey: string;
}

/**
 * Sign in with Apple.
 *
 * Apple posts the callback as a form because scopes are requested, and it sends
 * the user's name once, with the first authorization only. There is no userinfo
 * endpoint, so the profile comes from the id_token plus that one payload.
 *
 * Each exchange keeps the refresh token Apple returns, beside the client id that
 * obtained it, so deleting the account or unlinking Apple can revoke it.
 */
@Injectable()
export class AppleOAuthStrategy
  extends BaseOAuthStrategy
  implements RevocableProvider
{
  readonly id = 'apple';
  readonly displayName = 'Apple';
  readonly supportsPkce = false;
  readonly usesOidc = true;
  readonly emailAlwaysVerified = false;
  readonly autoLinksByEmail = true;
  readonly callbackMethod: OAuthCallbackMethod = 'POST';

  constructor(
    configService: ConfigService,
    @Optional() private readonly tokens?: ProviderTokenVault,
  ) {
    super(configService);
  }

  /** Apple has no client secret; the sign-in key stands in for it. */
  isEnabled(): boolean {
    const config = this.providerConfig;
    if (!config?.clientId) {
      return false;
    }
    const { TEAM_ID, KEY_ID, PRIVATE_KEY } = config.extra;
    return Boolean(TEAM_ID && KEY_ID && PRIVATE_KEY);
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const query = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: params.redirectUri,
      response_type: 'code',
      response_mode: 'form_post',
      scope: SCOPES.join(' '),
      state: params.state,
    });

    if (params.nonce) {
      query.set('nonce', params.nonce);
    }

    return `${AUTH_URL}?${query.toString()}`;
  }

  async exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens> {
    const response = await this.httpPostForm<AppleTokenResponse>(TOKEN_URL, {
      client_id: this.clientId(),
      client_secret: await this.clientSecret(),
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: 'authorization_code',
    });

    if (response.error || !response.id_token) {
      throw response.error
        ? this.codeExchangeFailed(OAuthFailureReason.PROVIDER_ERROR, {
            providerCode: response.error,
          })
        : this.codeExchangeFailed(OAuthFailureReason.NO_ID_TOKEN);
    }

    const claims = await this.verifyClaims(response.id_token, params.nonce);
    await this.tokens?.keep(
      { provider: this.id, subject: claims.sub, clientId: this.clientId() },
      response.refresh_token,
      this,
    );

    return {
      // Apple's access token only reaches the token revocation endpoint.
      accessToken: response.access_token ?? '',
      idToken: response.id_token,
      refreshToken: response.refresh_token,
      expiresIn: response.expires_in,
      tokenType: response.token_type,
    };
  }

  async fetchProfile(
    tokens: OAuthTokens,
    callbackParams?: OAuthCallbackParams,
  ): Promise<OAuthProfile> {
    if (!tokens.idToken) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_ID_TOKEN);
    }

    const claims = await this.verifyClaims(tokens.idToken);
    if (!claims.email) {
      throw this.profileFetchFailed(OAuthFailureReason.NO_EMAIL);
    }

    return {
      providerId: claims.sub,
      email: claims.email,
      emailVerified:
        claims.email_verified === true || claims.email_verified === 'true',
      name: readAppleUserName(callbackParams?.user) ?? claims.email,
    };
  }

  private async verifyClaims(
    idToken: string,
    nonce?: string,
  ): Promise<AppleIdTokenClaims> {
    try {
      return await verifyIdToken({
        idToken,
        jwksUri: JWKS_URI,
        issuers: ISSUERS,
        audience: this.clientId(),
        nonce,
      });
    } catch (error) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN, {
        joseCode: joseCodeOf(error),
      });
    }
  }

  async verifyNativeCredential(
    proof: NativeProviderProof,
  ): Promise<OAuthProfile> {
    if (
      proof.credential.kind !== 'appleIdentityTokenAndCode' ||
      proof.method.mode !== 'appleIdentityTokenAndCode'
    ) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN);
    }
    const audience = proof.method.sdk.appId;
    const options = {
      jwksUri: JWKS_URI,
      issuers: ISSUERS,
      audience,
      nonce: proof.nonceDigest,
    };
    try {
      const claims = await verifyNativeIdToken({
        ...options,
        idToken: proof.credential.identityToken,
      });
      const exchanged = await this.httpPostForm<AppleTokenResponse>(TOKEN_URL, {
        client_id: audience,
        client_secret: await this.clientSecret(audience),
        code: proof.credential.authorizationCode,
        grant_type: 'authorization_code',
      });
      if (exchanged.error || !exchanged.id_token) {
        throw this.codeExchangeFailed(OAuthFailureReason.NO_ID_TOKEN);
      }
      const confirmed = await verifyNativeIdToken({
        ...options,
        idToken: exchanged.id_token,
      });
      if (confirmed.sub !== claims.sub)
        throw new Error('Apple identity subject changed');
      await this.tokens?.keep(
        { provider: this.id, subject: confirmed.sub, clientId: audience },
        exchanged.refresh_token,
        this,
      );
      return nativeProfileFromClaims(claims);
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN, {
        joseCode: joseCodeOf(error),
      });
    }
  }

  /**
   * Revokes a kept refresh token with the client id that obtained it. Apple
   * answers a token that already grants nothing with `invalid_grant`, which
   * leaves nothing to revoke and settles the job too.
   */
  async revokeProviderToken(request: {
    token: string;
    clientId: string;
  }): Promise<RevocationAttempt> {
    let clientSecret: string;
    try {
      clientSecret = await this.clientSecret(request.clientId);
    } catch {
      return { kind: 'failed', code: REVOCATION_FAILURE.PROVIDER_UNAVAILABLE };
    }
    const response = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: request.clientId,
        client_secret: clientSecret,
        token: request.token,
        token_type_hint: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
    });
    if (response.ok || (await appleErrorOf(response)) === ALREADY_INVALID) {
      return { kind: 'revoked' };
    }
    return { kind: 'failed', code: REVOCATION_FAILURE.PROVIDER_REFUSED };
  }

  private async clientSecret(clientId = this.clientId()): Promise<string> {
    const { teamId, keyId, privateKey } = this.signingKey();

    try {
      return await createAppleClientSecret({
        teamId,
        keyId,
        privateKey,
        clientId,
      });
    } catch (error) {
      throw this.codeExchangeFailed(OAuthFailureReason.CLIENT_SECRET_SIGNING, {
        joseCode: joseCodeOf(error),
      });
    }
  }

  private clientId(): string {
    const clientId = this.providerConfig?.clientId;
    if (!clientId) {
      throw this.notConfigured();
    }
    return clientId;
  }

  private signingKey(): AppleSigningKey {
    const extra = this.providerConfig?.extra;
    if (!extra?.TEAM_ID || !extra.KEY_ID || !extra.PRIVATE_KEY) {
      throw this.notConfigured();
    }
    return {
      teamId: extra.TEAM_ID,
      keyId: extra.KEY_ID,
      privateKey: extra.PRIVATE_KEY,
    };
  }

  private notConfigured(): AppException {
    return new AppException(
      ErrorCode.OAUTH_NOT_CONFIGURED,
      `OAuth provider '${this.id}' is not configured`,
      HttpStatus.SERVICE_UNAVAILABLE,
      { provider: this.id },
    );
  }
}

/** Apple's `error` code from a refusal body, never its free text. */
async function appleErrorOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
      ? body.error
      : undefined;
  } catch {
    return undefined;
  }
}

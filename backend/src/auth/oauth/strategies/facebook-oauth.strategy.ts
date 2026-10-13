import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthFailureReason } from '../oauth.constants';
import { BaseOAuthStrategy, joseCodeOf } from '../base-oauth.strategy';
import type { NativeProviderProof } from '../types/native-provider';
import {
  nativeProfileFromClaims,
  verifyNativeIdToken,
} from '../utils/native-id-token.util';
import {
  AuthorizationUrlParams,
  ExchangeCodeParams,
  OAuthProfile,
  OAuthTokens,
} from '../oauth-provider.interface';

const GRAPH_VERSION = 'v26.0';
const AUTH_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const TOKEN_URL = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`;
const USER_URL = `https://graph.facebook.com/${GRAPH_VERSION}/me`;
const PROFILE_FIELDS = 'id,name,email,picture.type(large)';
const SCOPES = ['email', 'public_profile'];
const JWKS_URI = 'https://www.facebook.com/.well-known/oauth/openid/jwks/';
const ISSUERS = ['https://www.facebook.com'];
const DEBUG_TOKEN_URL = `https://graph.facebook.com/${GRAPH_VERSION}/debug_token`;

interface FacebookInspectedToken {
  data?: {
    is_valid?: boolean;
    type?: string;
    app_id?: string;
    user_id?: string;
    expires_at?: number;
    data_access_expires_at?: number;
  };
}

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

    if (!user || user.error) {
      // Facebook's graph error is free text and a numeric code; neither is loggable.
      throw this.profileFetchFailed(OAuthFailureReason.PROVIDER_ERROR);
    }
    if (
      typeof user.id !== 'string' ||
      !user.id.trim() ||
      typeof user.email !== 'string' ||
      !user.email.trim()
    ) {
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

  async verifyNativeCredential(
    proof: NativeProviderProof,
  ): Promise<OAuthProfile> {
    if (proof.method.mode !== 'facebook') {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN);
    }
    if (proof.credential.kind === 'facebookLimitedToken') {
      try {
        const claims = await verifyNativeIdToken({
          idToken: proof.credential.authenticationToken,
          jwksUri: JWKS_URI,
          issuers: ISSUERS,
          audience: proof.method.sdk.appId,
          nonce: proof.nonceDigest,
        });
        return nativeProfileFromClaims(claims, true);
      } catch (error) {
        throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN, {
          joseCode: joseCodeOf(error),
        });
      }
    }
    if (proof.credential.kind !== 'facebookAccessToken') {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN);
    }
    const { clientId, clientSecret } = this.credentials();
    if (clientId !== proof.method.sdk.appId) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN);
    }
    const query = new URLSearchParams({
      input_token: proof.credential.accessToken,
    });
    const inspected = await this.httpGetJson<FacebookInspectedToken>(
      `${DEBUG_TOKEN_URL}?${query.toString()}`,
      { Authorization: `Bearer ${clientId}|${clientSecret}` },
    );
    const data = inspected?.data;
    const now = Date.now() / 1000;
    if (
      data?.is_valid !== true ||
      data.type !== 'USER' ||
      data.app_id !== clientId ||
      typeof data.user_id !== 'string' ||
      !data.user_id.trim() ||
      typeof data.expires_at !== 'number' ||
      !Number.isFinite(data.expires_at) ||
      data.expires_at <= now ||
      typeof data.data_access_expires_at !== 'number' ||
      !Number.isFinite(data.data_access_expires_at) ||
      data.data_access_expires_at <= now
    ) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN);
    }
    const profile = await this.fetchProfile({
      accessToken: proof.credential.accessToken,
    });
    if (profile.providerId !== data.user_id) {
      throw this.profileFetchFailed(OAuthFailureReason.INVALID_TOKEN);
    }
    return profile;
  }
}

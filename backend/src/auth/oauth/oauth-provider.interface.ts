/**
 * Contract every OAuth provider implements. The registry resolves strategies by
 * `id`, so nothing outside a strategy needs to know which providers exist.
 */
import type { NativeProviderProof } from './types/native-provider';

export interface OAuthProviderStrategy {
  /** Slug used in routes, storage and the provider list, for example 'google'. */
  readonly id: string;

  /** Human readable name for the provider list. */
  readonly displayName: string;

  /** Environment variable prefix, for example 'OAUTH_GOOGLE'. */
  readonly envPrefix: string;

  /** Send a PKCE code challenge on authorize and a verifier on exchange. */
  readonly supportsPkce: boolean;

  /** Provider returns an id_token that carries a nonce. */
  readonly usesOidc: boolean;

  /** Provider only ever returns addresses it has verified itself. */
  readonly emailAlwaysVerified: boolean;

  /**
   * A first sign-in may attach to an account that already has the address.
   * Only for a provider that states, per address, that it verified it. One
   * that sends no such statement creates accounts and signs in its own, and
   * its user links it to an existing account from the settings instead.
   */
  readonly autoLinksByEmail: boolean;

  /**
   * HTTP method the provider uses for the callback. Apple posts a form when
   * scopes are requested; everyone else redirects with a GET. A POST arrives
   * cross site, so the state cookie for those providers needs SameSite=None.
   */
  readonly callbackMethod: OAuthCallbackMethod;

  /** True when the provider has credentials configured. */
  isEnabled(): boolean;

  getAuthorizationUrl(params: AuthorizationUrlParams): string;

  exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens>;

  /**
   * @param callbackParams raw query or form parameters of the callback, for
   * providers that return profile data outside the token response
   */
  fetchProfile(
    tokens: OAuthTokens,
    callbackParams?: OAuthCallbackParams,
  ): Promise<OAuthProfile>;

  verifyNativeCredential?(proof: NativeProviderProof): Promise<OAuthProfile>;
}

export type OAuthCallbackMethod = 'GET' | 'POST';

/** Query string (GET) or form body (POST) of the provider callback. */
export type OAuthCallbackParams = Record<string, string>;

export interface AuthorizationUrlParams {
  state: string;
  redirectUri: string;
  codeChallenge?: string;
  nonce?: string;
}

export interface ExchangeCodeParams {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  /** Expected id_token nonce for providers with `usesOidc`. */
  nonce?: string;
}

export interface OAuthTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
  tokenType?: string;
}

export interface OAuthProfile {
  providerId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl?: string;
}

/** Entry of the public provider list. */
export interface OAuthProviderSummary {
  id: string;
  displayName: string;
}

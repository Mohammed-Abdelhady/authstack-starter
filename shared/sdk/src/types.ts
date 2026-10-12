import type { DEVICE_KIND, OAuthTokenType, OAUTH_GRANT_TYPE } from './constants';
export * from './types/native-auth';

/** The account, as GET and PATCH /api/user/profile send it. Dates are ISO strings. */
export interface User {
  id: string;
  email: string;
  name: string;
  /** Role slug: user, support, manager, admin, or a custom role. */
  role: string;
  permissions: string[];
  /** `email`, or the OAuth provider the account was created with. */
  authProvider: string;
  isVerified: boolean;
  // feature:totp:start
  twoFactorEnabled: boolean;
  // feature:totp:end
  // feature:passkeys:start
  passkeyCount: number;
  // feature:passkeys:end
  avatarUrl?: string;
  linkedProviders: string[];
  primaryProvider?: string;
  profileSyncedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Public session bootstrap result. A signed-out request has no account data. */
export type Identity = { authenticated: false; user: null } | { authenticated: true; user: User };

export interface UpdateProfileRequest {
  name?: string;
}

export interface DeviceParts {
  kind: (typeof DEVICE_KIND)[keyof typeof DEVICE_KIND];
  browserName?: string;
  browserMajorVersion?: string;
  platformName?: string;
  platformVersion?: string;
}

export interface Session {
  id: string;
  userAgent: string;
  ip: string;
  deviceName?: string;
  deviceParts?: DeviceParts;
  createdAt: string;
  lastUsedAt?: string;
  isCurrent: boolean;
  /** Which credential the session runs on: a browser cookie or a native token family. */
  credentialPurpose: 'browser_session' | 'native_access';
}

export interface SessionList {
  sessions: Session[];
  total: number;
}

/** Reply of the routes that only confirm: session revoke and sign out. */
export interface MessageResult {
  message: string;
}

export interface RevokeOtherSessionsResult {
  revokedCount: number;
}

export interface AuthMethodProvider {
  id: string;
  displayName: string;
}

/** `methods` as GET /api/auth/methods sends it. A server built without a method leaves its key out. */
export interface AuthMethodsWire {
  password: boolean;
  // feature:magic-link:start
  magicLink: boolean;
  // feature:magic-link:end
  // feature:totp:start
  twoFactor: boolean;
  // feature:totp:end
  // feature:passkeys:start
  passkeys: boolean;
  // feature:passkeys:end
  // feature:oauth-core:start
  oauth: AuthMethodProvider[];
  // feature:oauth-core:end
}

export interface AuthMethodsResponse {
  methods: AuthMethodsWire;
}

/** Sign-in methods with every key present: one the server left out reads as off. */
export interface AuthMethods {
  password: boolean;
  magicLink: boolean;
  twoFactor: boolean;
  passkeys: boolean;
  oauth: AuthMethodProvider[];
}

/** Body of POST /api/oauth/token for an authorization code. */
export interface OAuthCodeTokenRequest {
  grant_type: typeof OAUTH_GRANT_TYPE.AUTHORIZATION_CODE;
  code: string;
  redirect_uri: string;
  client_id: string;
  code_verifier: string;
}

/** Body of POST /api/oauth/token for a refresh. */
export interface OAuthRefreshTokenRequest {
  grant_type: typeof OAUTH_GRANT_TYPE.REFRESH_TOKEN;
  refresh_token: string;
  client_id: string;
}

export type OAuthTokenRequest = OAuthCodeTokenRequest | OAuthRefreshTokenRequest;

export interface OAuthTokenResponse {
  access_token: string;
  token_type: OAuthTokenType;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** Body of POST /api/oauth/revoke. The reply is an empty object. */
export interface OAuthRevokeRequest {
  token: string;
  client_id?: string;
}

export interface ExchangeCodeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}

export interface RefreshTokenInput {
  refreshToken: string;
  clientId: string;
}

export interface RevokeTokenInput {
  token: string;
  clientId?: string;
}

/** `OAuthTokenResponse` in the client's own naming. */
export interface TokenSet {
  accessToken: string;
  tokenType: OAuthTokenType;
  /** Lifetime of the access token, in seconds. */
  expiresIn: number;
  refreshToken: string;
  scope: string;
}

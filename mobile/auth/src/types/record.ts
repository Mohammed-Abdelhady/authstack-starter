export interface AuthRecordFields {
  schemaVersion: number;
  serverBaseAddress: string;
  environment: string;
  clientId: string;
  installDigest: string;
}

export type AuthRecord = SessionAuthRecord | PendingAuthRecord;

export interface SessionAuthRecord extends AuthRecordFields {
  lineageId: string;
  tokens: StoredTokens;
  proofKeyThumbprint?: string;
  authorizationOperationId?: undefined;
  transaction?: undefined;
  nativeAttempt?: undefined;
  refreshInFlight?: boolean;
}

export interface PendingAuthRecord extends AuthRecordFields {
  lineageId?: string;
  proofKeyThumbprint?: undefined;
  tokens?: undefined;
  authorizationOperationId?: string;
  transaction?: AuthTransaction;
  nativeAttempt?: NativePendingAttempt;
  refreshInFlight?: undefined;
}

export type LegacyTokenRecord = AuthRecordFields & {
  lineageId?: undefined;
  tokens: StoredTokens;
  proofKeyThumbprint?: string;
  authorizationOperationId?: undefined;
  transaction?: undefined;
  nativeAttempt?: undefined;
  refreshInFlight?: boolean;
};

export type StoredAuthRecord = AuthRecord | LegacyTokenRecord;

export interface AuthTransaction {
  verifier: string;
  state: string;
  returnAddress: string;
  createdAt: number;
  expiresAt: number;
  operationId: string;
  kind?: 'native';
}

export interface NativePendingAttempt {
  id: string;
  secret: string;
  nonceDigest: string;
  flow: 'signIn' | 'registration' | 'recovery';
  activationCompleted?: boolean;
}

export interface StoredTokens {
  refreshToken: string;
}

export interface RuntimeTokens extends StoredTokens {
  accessToken: string;
  expiresAt: number;
  version: number;
  lineageId: string;
  proofKeyThumbprint?: string;
}

/**
 * A refresh token the person signed out of, kept only until the server
 * revokes it. Restore and refresh never read it: it cannot sign in.
 */
export interface PendingRevocation {
  serverBaseAddress: string;
  environment: string;
  clientId: string;
  installDigest: string;
  /** Absent for a token saved before sessions carried a lineage. */
  lineageId?: string;
  refreshToken: string;
  /** The device key binding the token was issued under. */
  proofKeyThumbprint?: string;
  attempts: number;
  /** Wall time, in milliseconds, before which no attempt is made. */
  nextAttemptAt: number;
  /** The server sends no refresh lifetime, so it is never known here. */
  refreshExpiresAt: null;
}

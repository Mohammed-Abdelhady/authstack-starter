export interface ParsedAuthRecord {
  schemaVersion?: unknown;
  serverBaseAddress?: unknown;
  environment?: unknown;
  clientId?: unknown;
  installDigest?: unknown;
  lineageId?: unknown;
  proofKeyThumbprint?: unknown;
  authorizationOperationId?: unknown;
  refreshInFlight?: unknown;
  transaction?: unknown;
  nativeAttempt?: unknown;
  tokens?: unknown;
}

export interface ParsedAuthTransaction {
  verifier?: unknown;
  state?: unknown;
  returnAddress?: unknown;
  createdAt?: unknown;
  expiresAt?: unknown;
  operationId?: unknown;
  kind?: unknown;
}

export interface ParsedNativeAttempt {
  id?: unknown;
  secret?: unknown;
  nonceDigest?: unknown;
  flow?: unknown;
  activationCompleted?: unknown;
}

export interface ParsedStoredTokens {
  refreshToken?: unknown;
}

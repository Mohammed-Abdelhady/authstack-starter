/** A mobile sign-in request as it is stored. A field never written is absent. */
export interface StoredAuthorizationRequest {
  transactionId: string;
  clientId: string;
  redirectUri: string;
  consumed: boolean;
  requestedScopes: string[];
  codeHash?: string;
  userId?: string;
}

/** A mobile access or refresh token as it is stored. */
export interface StoredNativeCredential {
  sessionId: string;
  purpose: string;
  spent: boolean;
  revokedAt?: Date;
  proofKeyThumbprint?: string;
}

/** Holds one read of a sign-in request after it has answered. */
export interface AuthorizationReadGate {
  reached: Promise<void>;
  release(): void;
  restore(): void;
}

/** What only the mobile sign-in cases arrange and read. */
export interface E2eNativeState {
  authorizationRequest(
    transactionId: string,
  ): Promise<StoredAuthorizationRequest | null>;
  /** The request whose authorization code has this hash. */
  authorizationRequestForCode(
    codeHash: string,
  ): Promise<StoredAuthorizationRequest | null>;
  authorizationRequestCount(): Promise<number>;
  /** How many requests with this id hold an authorization code. */
  approvedAuthorizationRequestCount(transactionId: string): Promise<number>;
  /** Stores a return address on a request as given, unchecked. */
  storeAuthorizationRedirect(
    transactionId: string,
    redirectUri: string,
  ): Promise<void>;
  /** Holds the next read of a pending request until released. */
  pauseNextAuthorizationRead(): AuthorizationReadGate;

  credentialCount(): Promise<number>;
  /** The stored tokens with these hashes, ordered by purpose. */
  credentialsForTokens(
    tokenHashes: string[],
  ): Promise<StoredNativeCredential[]>;
}

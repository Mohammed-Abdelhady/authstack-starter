/** What one call to a provider's revocation endpoint came to. */
export type RevocationAttempt =
  { kind: 'revoked' } | { kind: 'failed'; code: string };

/** A provider strategy that can revoke a refresh token it issued. */
export interface RevocableProvider {
  revokeProviderToken(request: {
    token: string;
    clientId: string;
  }): Promise<RevocationAttempt>;
}

export function isRevocableProvider(
  strategy: object,
): strategy is RevocableProvider {
  return (
    'revokeProviderToken' in strategy &&
    typeof strategy.revokeProviderToken === 'function'
  );
}

/** Finds the enabled strategy that revokes one provider's tokens. */
export abstract class RevocableProviders {
  abstract find(providerId: string): RevocableProvider | undefined;
}

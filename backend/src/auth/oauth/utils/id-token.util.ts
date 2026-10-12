import {
  createLocalJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from 'jose';

/**
 * id_token verification for the OIDC providers. The JWKS document is fetched
 * here rather than through jose's remote key set so the cache TTL and the
 * failure messages stay under our control.
 */

export interface IdTokenClaims extends JWTPayload {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  /** Entra ID tenant the token was issued for. */
  tid?: string;
}

export interface VerifyIdTokenOptions {
  idToken: string;
  jwksUri: string;
  /** Accepted issuers. Leave empty when `issuerTemplate` is set. */
  issuers?: string[];
  /**
   * Issuer with a `{tid}` placeholder, for providers whose issuer carries the
   * tenant id. The token's own `tid` claim fills the placeholder, so a token
   * from any tenant is accepted but only in the shape the provider issues.
   */
  issuerTemplate?: string;
  audience: string;
  nonce?: string;
  clockToleranceSeconds?: number;
  /** Signing algorithms to accept. Defaults to RS256. */
  algorithms?: string[];
  requiredClaims?: string[];
}

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;
const DEFAULT_ALGORITHMS = ['RS256'];
const TENANT_PLACEHOLDER = '{tid}';
const JWKS_HTTP_TIMEOUT_MS = 10_000;

interface JwksCacheEntry {
  document: JSONWebKeySet;
  fetchedAt: number;
}

const jwksCache = new Map<string, JwksCacheEntry>();

/** Drops cached JWKS documents. Used by tests and after a key rollover. */
export function resetJwksCache(): void {
  jwksCache.clear();
}

async function fetchJwks(jwksUri: string): Promise<JSONWebKeySet> {
  let response: Response;
  try {
    response = await fetch(jwksUri, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(JWKS_HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new Error('JWKS request timed out');
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(
      `JWKS request failed: ${response.status} ${response.statusText}`,
    );
  }

  const document = (await response.json()) as JSONWebKeySet;
  if (!Array.isArray(document.keys)) {
    throw new Error('JWKS response has no keys');
  }

  jwksCache.set(jwksUri, { document, fetchedAt: Date.now() });
  return document;
}

async function loadJwks(jwksUri: string): Promise<JSONWebKeySet> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.document;
  }

  return fetchJwks(jwksUri);
}

function assertIssuer(claims: IdTokenClaims, template: string): void {
  if (typeof claims.tid !== 'string' || claims.tid.length === 0) {
    throw new Error('id_token has no tid claim to resolve the issuer with');
  }

  const expected = template.replace(TENANT_PLACEHOLDER, claims.tid);
  if (claims.iss !== expected) {
    throw new Error(`id_token issuer ${claims.iss} is not accepted`);
  }
}

/**
 * Verifies signature, issuer, audience, expiry and nonce of an id_token.
 *
 * @throws Error when any check fails
 */
export async function verifyIdToken(
  options: VerifyIdTokenOptions,
): Promise<IdTokenClaims> {
  const keySet = createLocalJWKSet(await loadJwks(options.jwksUri));

  const { payload } = await jwtVerify(options.idToken, keySet, {
    audience: options.audience,
    issuer: options.issuerTemplate ? undefined : options.issuers,
    algorithms: options.algorithms ?? DEFAULT_ALGORITHMS,
    requiredClaims: options.requiredClaims,
    clockTolerance:
      options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS,
  });

  const claims = payload as IdTokenClaims;

  if (options.issuerTemplate) {
    assertIssuer(claims, options.issuerTemplate);
  }

  if (options.nonce !== undefined && claims.nonce !== options.nonce) {
    throw new Error('id_token nonce does not match');
  }

  return claims;
}

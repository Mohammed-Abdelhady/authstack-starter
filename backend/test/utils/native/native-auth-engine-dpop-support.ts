import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  API_PATHS,
  DPOP_PROOF_HEADER,
  OAUTH_ERROR,
  OAUTH_GRANT_TYPE,
} from '@app/sdk';
import { hashToken } from '../../../src/session/utils/hashing/token-hash';
import type { E2eApp } from '../e2e-app';
import {
  readStoredAuthRecord,
  type EngineHarness,
} from './native-auth-engine-harness';

export interface CompactProof {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
}

export interface TokenReply {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export const ACCESS_TOKEN_MARGIN_MS = 270_000;

export function advanceAccessClock(
  harness: EngineHarness,
  milliseconds: number,
): void {
  harness.ports.clock.advance(milliseconds);
  harness.serverClock.advance(milliseconds);
}

export function tokenEntries(harness: EngineHarness) {
  return harness.requests.flatMap((request, index) =>
    request.path === API_PATHS.oauth.token ||
    request.path === API_PATHS.oauth.revoke
      ? [{ request, response: harness.responses[index] }]
      : [],
  );
}

export function isCodeExchange(
  value: unknown,
): value is { grant_type: string; code: string } {
  return (
    isObject(value) &&
    value.grant_type === OAUTH_GRANT_TYPE.AUTHORIZATION_CODE &&
    typeof value.code === 'string'
  );
}

export function tokenReply(value: unknown): TokenReply {
  if (
    !isObject(value) ||
    typeof value.access_token !== 'string' ||
    typeof value.refresh_token !== 'string' ||
    typeof value.token_type !== 'string'
  ) {
    throw new Error('Expected a token response');
  }
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    token_type: value.token_type,
  };
}

export function parseProof(
  request: EngineHarness['requests'][number] | undefined,
): CompactProof {
  const proof = request?.headers?.[DPOP_PROOF_HEADER];
  if (!proof) throw new Error('DPoP proof was not sent');
  const [header, claims] = proof.split('.');
  return {
    header: parseJsonObject(header),
    claims: parseJsonObject(claims),
  };
}

export function parseProofOptional(
  request: EngineHarness['requests'][number] | undefined,
): CompactProof | undefined {
  if (request?.headers?.[DPOP_PROOF_HEADER] === undefined) return undefined;
  return parseProof(request);
}

export function tokenHashClaim(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export async function credentialsFor(e2e: E2eApp, pair: TokenReply) {
  return e2e.state.native.credentialsForTokens(
    [pair.access_token, pair.refresh_token].map(hashToken),
  );
}

export async function credentialsForToken(e2e: E2eApp, token: string) {
  return e2e.state.native.credentialsForTokens([hashToken(token)]);
}

export async function sessionFor(e2e: E2eApp, id: string | undefined) {
  if (id === undefined) throw new Error('Credential session id was missing');
  const session = await e2e.state.sessions.session(id);
  if (!session) throw new Error('Native session was missing');
  return session;
}

export function requiredSessionFields(
  record: Awaited<ReturnType<typeof readStoredAuthRecord>>,
): { refreshToken: string; lineageId: string; proofKeyThumbprint?: string } {
  if (
    record === undefined ||
    !('tokens' in record) ||
    record.tokens === undefined ||
    typeof record.lineageId !== 'string'
  ) {
    throw new Error('A stored session record was missing');
  }
  return {
    refreshToken: record.tokens.refreshToken,
    lineageId: record.lineageId,
    ...(record.proofKeyThumbprint === undefined
      ? {}
      : { proofKeyThumbprint: record.proofKeyThumbprint }),
  };
}

export function refreshTokenFrom(value: unknown): string {
  if (!isObject(value) || typeof value.refresh_token !== 'string') {
    throw new Error('Refresh token request body was missing');
  }
  return value.refresh_token;
}

export function revokeTokenFrom(value: unknown): string {
  if (!isObject(value) || typeof value.token !== 'string') {
    throw new Error('Revoke request body was missing');
  }
  return value.token;
}

export function firstNonce(harness: EngineHarness): string {
  for (const entry of tokenEntries(harness)) {
    if (
      entry.request.path === API_PATHS.oauth.token &&
      isObject(entry.request.body) &&
      entry.request.body.grant_type === OAUTH_GRANT_TYPE.REFRESH_TOKEN &&
      isObject(entry.response?.body) &&
      entry.response.body.error === OAUTH_ERROR.USE_DPOP_NONCE
    ) {
      const nonce = entry.response?.headers?.['DPoP-Nonce'];
      if (typeof nonce === 'string') return nonce;
    }
  }
  throw new Error('No refresh nonce challenge was captured');
}

function parseJsonObject(encoded: string | undefined): Record<string, unknown> {
  if (encoded === undefined) throw new Error('Compact proof part was missing');
  const parsed: unknown = JSON.parse(
    Buffer.from(encoded, 'base64url').toString('utf8'),
  );
  if (!isObject(parsed))
    throw new Error('Compact proof part was not an object');
  return parsed;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

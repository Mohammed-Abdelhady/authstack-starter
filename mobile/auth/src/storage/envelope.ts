import {
  CREDENTIAL_ENVELOPE_VERSION,
  PENDING_REVOCATION_MAX_ENTRIES,
  PENDING_REVOCATION_MAX_IDENTIFIER_LENGTH,
  PENDING_REVOCATION_MAX_TOKEN_LENGTH,
} from '../constants';
import type { ParsedEnvelope, ParsedPendingRevocation } from '../types/record-json';
import type { PendingRevocation, StoredAuthRecord } from '../types/record';
import { parseStoredRecord } from './persistence';

/** What one stored value turned out to hold. */
export type StoredValue =
  | { kind: 'read'; session: StoredAuthRecord | undefined; pending: PendingRevocation[] }
  /** A version this build does not know: never read as the current format. */
  | { kind: 'unsupported' }
  | { kind: 'unreadable' };

const UNREADABLE: StoredValue = { kind: 'unreadable' };

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= PENDING_REVOCATION_MAX_IDENTIFIER_LENGTH;
}

function isOptionalIdentifier(value: unknown): boolean {
  return value === undefined || isIdentifier(value);
}

function readPending(input: unknown): PendingRevocation | undefined {
  if (!isObject(input)) return undefined;
  const value: ParsedPendingRevocation = input;
  if (
    !isIdentifier(value.serverBaseAddress) ||
    !isIdentifier(value.environment) ||
    !isIdentifier(value.clientId) ||
    !isIdentifier(value.installDigest) ||
    !isOptionalIdentifier(value.lineageId) ||
    typeof value.refreshToken !== 'string' ||
    value.refreshToken.length === 0 ||
    value.refreshToken.length > PENDING_REVOCATION_MAX_TOKEN_LENGTH ||
    !isOptionalIdentifier(value.proofKeyThumbprint) ||
    typeof value.attempts !== 'number' ||
    !Number.isInteger(value.attempts) ||
    value.attempts < 0 ||
    typeof value.nextAttemptAt !== 'number' ||
    !Number.isFinite(value.nextAttemptAt) ||
    value.refreshExpiresAt !== null
  )
    return undefined;
  return {
    serverBaseAddress: value.serverBaseAddress,
    environment: value.environment,
    clientId: value.clientId,
    installDigest: value.installDigest,
    ...(typeof value.lineageId === 'string' ? { lineageId: value.lineageId } : {}),
    refreshToken: value.refreshToken,
    ...(typeof value.proofKeyThumbprint === 'string'
      ? { proofKeyThumbprint: value.proofKeyThumbprint }
      : {}),
    attempts: value.attempts,
    nextAttemptAt: value.nextAttemptAt,
    refreshExpiresAt: null,
  };
}

/** A bounded list with one entry per lineage and per token; anything else fails closed. */
function readPendingList(input: unknown): PendingRevocation[] | undefined {
  if (!Array.isArray(input) || input.length > PENDING_REVOCATION_MAX_ENTRIES) return undefined;
  const pending: PendingRevocation[] = [];
  const lineages = new Set<string>();
  const tokens = new Set<string>();
  for (const item of input) {
    const revocation = readPending(item);
    if (!revocation || tokens.has(revocation.refreshToken)) return undefined;
    if (revocation.lineageId !== undefined) {
      if (lineages.has(revocation.lineageId)) return undefined;
      lineages.add(revocation.lineageId);
    }
    tokens.add(revocation.refreshToken);
    pending.push(revocation);
  }
  return pending;
}

/**
 * Reads a stored value. One without `version` is the earlier format: the
 * session alone, with nothing waiting. The session fields sit beside
 * `version` and `pendingRevocations`, so a reader of the earlier format still
 * finds them; a pending revocation is never read as a session.
 */
export function readStoredValue(value: string): StoredValue {
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    return UNREADABLE;
  }
  if (!isObject(input)) return UNREADABLE;
  if (!('version' in input)) {
    const session = parseStoredRecord(value);
    return session ? { kind: 'read', session, pending: [] } : UNREADABLE;
  }
  const envelope: ParsedEnvelope = input;
  if (envelope.version !== CREDENTIAL_ENVELOPE_VERSION) return { kind: 'unsupported' };
  const pending = readPendingList(envelope.pendingRevocations);
  if (!pending) return UNREADABLE;
  if (envelope.serverBaseAddress === undefined)
    return { kind: 'read', session: undefined, pending };
  const session = parseStoredRecord(value);
  return session ? { kind: 'read', session, pending } : UNREADABLE;
}

/**
 * The value to store for a session (serialized, or none) and what waits on the
 * server. With nothing waiting it is the session as before, so every value
 * written by an earlier build and every reader of it stay unchanged.
 */
export function serializeStoredValue(
  session: string | undefined,
  pending: readonly PendingRevocation[],
): string | undefined {
  if (pending.length === 0) return session;
  let fields: object = {};
  if (session !== undefined) {
    const parsed: unknown = JSON.parse(session);
    if (isObject(parsed)) fields = parsed;
  }
  return JSON.stringify({
    ...fields,
    version: CREDENTIAL_ENVELOPE_VERSION,
    pendingRevocations: pending,
  });
}

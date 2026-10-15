import {
  CREDENTIAL_READ_TIMEOUT_MS,
  PENDING_REVOCATION_MAX_ENTRIES,
  PORT_OPERATION,
  REVOKE_OUTCOME,
} from '../constants';
import { withPortDeadline } from '../runtime/deadlines';
import type { AuthRuntime } from '../runtime/runtime';
import { readStoredValue } from '../storage/envelope';
import { holdPendingRevocations, pendingKnown } from '../storage/pending-revocations';
import { recordMatches } from '../storage/persistence';
import type { PendingRevocation } from '../types/record';
import type { RevokeResult } from './revocation';
import { retryDelay } from './revocation-retry';

export interface SignedOutToken {
  refreshToken?: string | undefined;
  lineageId?: string | undefined;
  proofKeyThumbprint?: string | undefined;
  installDigest?: string | undefined;
  readError?: Error | undefined;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The stored session's token, for a sign-out before anything was read. What
 * already waits beside it is kept, so the sign-out's write does not drop it.
 */
export async function readStoredToken(runtime: AuthRuntime): Promise<SignedOutToken> {
  const unavailable = new Error('The saved auth record is unavailable');
  try {
    const stored = await withPortDeadline(
      runtime.dependencies.timer,
      CREDENTIAL_READ_TIMEOUT_MS,
      () => runtime.dependencies.credentials.read(),
      PORT_OPERATION.CREDENTIALS_READ,
    );
    if (stored.kind === 'missing') return {};
    if (stored.kind !== 'found') return { readError: unavailable };
    const read = readStoredValue(stored.value);
    if (read.kind !== 'read') return { readError: unavailable };
    if (!pendingKnown(runtime)) holdPendingRevocations(runtime, read.pending);
    const record = read.session;
    if (!record || !recordMatches(record, runtime.config, record.installDigest)) return {};
    return {
      ...(record.tokens?.refreshToken === undefined
        ? {}
        : { refreshToken: record.tokens.refreshToken }),
      ...(record.lineageId === undefined ? {} : { lineageId: record.lineageId }),
      ...(record.proofKeyThumbprint === undefined
        ? {}
        : { proofKeyThumbprint: record.proofKeyThumbprint }),
      installDigest: record.installDigest,
    };
  } catch (error) {
    return { readError: asError(error) };
  }
}

/** The intent with its first attempt already reserved, stored in the same write. */
export function reservedIntent(
  runtime: AuthRuntime,
  token: SignedOutToken,
  refreshToken: string,
): PendingRevocation {
  let now = 0;
  try {
    now = runtime.wallTime();
  } catch {
    now = 0;
  }
  return {
    serverBaseAddress: runtime.config.serverBaseAddress,
    environment: runtime.config.environment,
    clientId: runtime.config.clientId,
    installDigest: token.installDigest ?? '',
    ...(token.lineageId === undefined ? {} : { lineageId: token.lineageId }),
    refreshToken,
    ...(token.proofKeyThumbprint === undefined
      ? {}
      : { proofKeyThumbprint: token.proofKeyThumbprint }),
    attempts: 1,
    nextAttemptAt: now + retryDelay(1),
    refreshExpiresAt: null,
  };
}

/**
 * The latest list with the intent added: one entry per lineage and per token,
 * and never more than the stored value may hold, the oldest leaving first.
 */
export function withIntent(
  list: readonly PendingRevocation[],
  intent: PendingRevocation,
): { next: PendingRevocation[]; dropped: PendingRevocation[] } {
  const kept = list.filter(
    (other) =>
      other.refreshToken !== intent.refreshToken &&
      (intent.lineageId === undefined || other.lineageId !== intent.lineageId),
  );
  const room = PENDING_REVOCATION_MAX_ENTRIES - 1;
  const dropped = kept.length > room ? kept.slice(0, kept.length - room) : [];
  return { next: [...kept.slice(dropped.length), intent], dropped };
}

/** What a sign-out without a token of its own reports once due revocations were tried. */
export function drainedOutcome(
  results: ReadonlyMap<string, RevokeResult>,
): RevokeResult | undefined {
  const all = [...results.values()];
  return all.find((result) => result.outcome !== REVOKE_OUTCOME.REVOKED) ?? all[0];
}

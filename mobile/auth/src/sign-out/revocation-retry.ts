import type { ApiClient } from '@app/sdk';
import {
  PENDING_REVOCATION_END,
  PENDING_REVOCATION_MAX_ATTEMPTS,
  PENDING_REVOCATION_RETRY_DELAYS_MS,
} from '../constants';
import { DeviceKeyAuthError } from '../errors/errors';
import type { AuthRuntime } from '../runtime/runtime';
import {
  pendingRevocations,
  recordEndedRevocation,
  registerRevocationDrain,
  updatePendingRevocations,
  type PendingRevocationEnd,
} from '../storage/pending-revocations';
import type { AbortSignalPort } from '../types/auth';
import type { PendingRevocation } from '../types/record';
import { revokeWithDeadline, type RevokeResult } from './revocation';

export type RevocationResults = ReadonlyMap<string, RevokeResult>;

/** One entry per lineage and token, the same before and after a write. */
export function revocationKey(entry: Pick<PendingRevocation, 'lineageId' | 'refreshToken'>) {
  return `${entry.lineageId ?? ''}\u0000${entry.refreshToken}`;
}

/** One revoke of a pending entry, with the binding its token was issued under. */
export function revokePending(
  runtime: AuthRuntime,
  client: ApiClient<AbortSignalPort>,
  entry: PendingRevocation,
): Promise<RevokeResult> {
  return revokeWithDeadline(
    client,
    runtime.dependencies,
    entry.refreshToken,
    entry.clientId,
    entry.proofKeyThumbprint === undefined
      ? undefined
      : {
          serverBaseAddress: entry.serverBaseAddress,
          proofKeyThumbprint: entry.proofKeyThumbprint,
        },
  );
}

/** The wait after `attemptsMade` tries. The last delay repeats. */
export function retryDelay(attemptsMade: number): number {
  const delays = PENDING_REVOCATION_RETRY_DELAYS_MS;
  return delays[Math.min(attemptsMade, delays.length) - 1] ?? delays[delays.length - 1] ?? 0;
}

/** The binding can never be proved again: the key is gone or is not the bound one. */
function deviceKeyGone(result: RevokeResult): boolean {
  return (
    result.error instanceof DeviceKeyAuthError &&
    (result.error.reason === 'keyInvalidated' || result.error.reason === 'thumbprintMismatch')
  );
}

function current(runtime: AuthRuntime, key: string): PendingRevocation | undefined {
  return pendingRevocations(runtime).find((entry) => revocationKey(entry) === key);
}

/**
 * Tries each due pending revocation once. Each try is reserved first: its
 * attempt and next due time are stored before anything is sent, and nothing
 * is sent when that write fails. A confirmed one leaves storage, as does one
 * whose device key is gone for good or that reached the attempt limit. Tries
 * happen at sign-out and on every restore, which runs at start and on each
 * return to the foreground: there is no network signal and no standing timer.
 */
export function createRevocationDrain(
  runtime: AuthRuntime,
  client: ApiClient<AbortSignalPort>,
): (reservedKey?: string) => Promise<RevocationResults> {
  // A drain asked for while one waits to start joins it; one asked for while it runs follows it.
  let waiting: { promise: Promise<RevocationResults>; reserved: Set<string> } | undefined;
  let tail: Promise<unknown> = Promise.resolve();

  /** Removes the entry by identity from the latest committed list. */
  const end = async (key: string, lineageId: string | undefined, reason: PendingRevocationEnd) => {
    const stored = await updatePendingRevocations(runtime, (list) =>
      list.some((entry) => revocationKey(entry) === key)
        ? list.filter((entry) => revocationKey(entry) !== key)
        : undefined,
    );
    if (stored.written) recordEndedRevocation(runtime, reason, lineageId);
  };

  /** Stores the next attempt before it is made. */
  const reserve = async (key: string, now: number): Promise<'saved' | 'gone' | 'notSaved'> => {
    const stored = await updatePendingRevocations(runtime, (list) =>
      list.some((entry) => revocationKey(entry) === key)
        ? list.map((entry) =>
            revocationKey(entry) === key
              ? {
                  ...entry,
                  attempts: entry.attempts + 1,
                  nextAttemptAt: now + retryDelay(entry.attempts + 1),
                }
              : entry,
          )
        : undefined,
    );
    if (stored.written) return 'saved';
    return stored.unchanged ? 'gone' : 'notSaved';
  };

  const run = async (reserved: ReadonlySet<string>): Promise<RevocationResults> => {
    // A sign-out disposed part way still makes its attempt; writes after disposal check the slot.
    const results = new Map<string, RevokeResult>();
    if (pendingRevocations(runtime).length === 0) return results;
    let now: number;
    try {
      now = runtime.wallTime();
    } catch {
      return results;
    }
    const { serverBaseAddress, environment, clientId } = runtime.config;
    for (const key of pendingRevocations(runtime).map(revocationKey)) {
      // Read against the latest committed list: an earlier step may have removed it.
      const entry = current(runtime, key);
      if (!entry) continue;
      if (
        entry.serverBaseAddress !== serverBaseAddress ||
        entry.environment !== environment ||
        entry.clientId !== clientId
      ) {
        await end(key, entry.lineageId, PENDING_REVOCATION_END.OTHER_APPLICATION);
        continue;
      }
      if (!reserved.has(key)) {
        // The server sends no refresh lifetime, so the attempt limit is what ends a token.
        if (entry.attempts >= PENDING_REVOCATION_MAX_ATTEMPTS) {
          await end(key, entry.lineageId, PENDING_REVOCATION_END.ATTEMPT_LIMIT);
          continue;
        }
        if (entry.nextAttemptAt > now) continue;
        const reservation = await reserve(key, now);
        if (reservation === 'gone') continue;
        // Storage that refuses the reservation would let every start retry unbounded: stop.
        if (reservation === 'notSaved') break;
      }
      const sent = current(runtime, key) ?? entry;
      const result = await revokePending(runtime, client, sent);
      results.set(key, result);
      if (result.outcome === 'revoked') {
        await end(key, entry.lineageId, PENDING_REVOCATION_END.REVOKED);
      } else if (deviceKeyGone(result)) {
        await end(key, entry.lineageId, PENDING_REVOCATION_END.DEVICE_KEY_GONE);
      }
    }
    return results;
  };

  const drain = (reservedKey?: string): Promise<RevocationResults> => {
    if (waiting) {
      if (reservedKey !== undefined) waiting.reserved.add(reservedKey);
      return waiting.promise;
    }
    const reserved = new Set<string>(reservedKey === undefined ? [] : [reservedKey]);
    const next: Promise<RevocationResults> = tail.then(() => {
      if (waiting?.promise === next) waiting = undefined;
      return run(reserved);
    });
    waiting = { promise: next, reserved };
    tail = next.catch(() => undefined);
    return next;
  };
  registerRevocationDrain(runtime, () => drain().then(() => undefined));
  return drain;
}

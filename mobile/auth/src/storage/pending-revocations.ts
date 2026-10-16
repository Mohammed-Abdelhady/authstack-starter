import {
  CREDENTIAL_READ_TIMEOUT_MS,
  CREDENTIAL_WRITE_TIMEOUT_MS,
  DISPOSED_RECORD_READ_ATTEMPT_TIMEOUT_MS,
  PENDING_REVOCATION_END,
  PENDING_REVOCATION_ENDED_HISTORY,
  PORT_OPERATION,
} from '../constants';
import { withPortDeadline } from '../runtime/deadlines';
import type { AuthRuntime } from '../runtime/runtime';
import type { PendingRevocation } from '../types/record';
import {
  enqueueCredentialWrite,
  matchesCredentialRecordGuard,
  type CredentialRecordGuard,
} from './credential-record-store';
import { writeStoredValue } from './credential-write';
import { readStoredValue, serializeStoredValue } from './envelope';

export type PendingRevocationEnd =
  (typeof PENDING_REVOCATION_END)[keyof typeof PENDING_REVOCATION_END];

/** Why a pending revocation left storage; the engine keeps the latest few. */
export interface EndedRevocation {
  lineageId?: string;
  reason: PendingRevocationEnd;
}

interface PendingState {
  pending: readonly PendingRevocation[];
  /** Whether `pending` reflects the stored value, read or written by this engine. */
  known: boolean;
  ended: EndedRevocation[];
  drain?: () => Promise<void>;
}

// Engine state lives on the runtime; this map keeps it in this folder.
const states = new WeakMap<AuthRuntime, PendingState>();

function stateOf(runtime: AuthRuntime): PendingState {
  let state = states.get(runtime);
  if (!state) {
    state = { pending: [], known: false, ended: [] };
    states.set(runtime, state);
  }
  return state;
}

/** The revocations waiting on the server, as last committed by this engine. */
export function pendingRevocations(runtime: AuthRuntime): readonly PendingRevocation[] {
  return stateOf(runtime).pending;
}

export function pendingKnown(runtime: AuthRuntime): boolean {
  return stateOf(runtime).known;
}

/** What the stored value says waits, once it has been read or written. */
export function holdPendingRevocations(
  runtime: AuthRuntime,
  pending: readonly PendingRevocation[],
): void {
  const state = stateOf(runtime);
  state.pending = pending;
  state.known = true;
}

/**
 * Before this engine replaces or clears the slot, learn what already waits in
 * it, so a write never drops a revocation an earlier run left behind. A value
 * that cannot be read holds nothing valid to keep.
 */
export async function ensurePendingKnown(runtime: AuthRuntime): Promise<void> {
  if (stateOf(runtime).known) return;
  try {
    const stored = await withPortDeadline(
      runtime.dependencies.timer,
      CREDENTIAL_READ_TIMEOUT_MS,
      () => runtime.dependencies.credentials.read(),
      PORT_OPERATION.CREDENTIALS_READ,
    );
    if (stored.kind === 'missing') holdPendingRevocations(runtime, []);
    if (stored.kind !== 'found') return;
    const read = readStoredValue(stored.value);
    holdPendingRevocations(runtime, read.kind === 'read' ? read.pending : []);
  } catch {
    // Still unknown: the next write tries again.
  }
}

export function recordEndedRevocation(
  runtime: AuthRuntime,
  reason: PendingRevocationEnd,
  lineageId?: string,
): void {
  const { ended } = stateOf(runtime);
  ended.push(lineageId === undefined ? { reason } : { lineageId, reason });
  if (ended.length > PENDING_REVOCATION_ENDED_HISTORY) ended.shift();
}

/** The latest pending revocations that left storage, and why. */
export function endedRevocations(runtime: AuthRuntime): readonly EndedRevocation[] {
  return stateOf(runtime).ended;
}

/** Sign-out hands over the attempt runner, so restore can start one without its client. */
export function registerRevocationDrain(runtime: AuthRuntime, drain: () => Promise<void>): void {
  stateOf(runtime).drain = drain;
}

export function drainPendingRevocations(runtime: AuthRuntime): Promise<void> {
  return stateOf(runtime).drain?.() ?? Promise.resolve();
}

export type PendingStoreResult =
  | { written: true }
  /** `unchanged`: the change found nothing to do against the latest list. */
  | { written: false; error?: Error; unchanged?: true };

/** Works out the next list from the latest committed one; undefined writes nothing. */
export type PendingChange = (
  current: readonly PendingRevocation[],
) => readonly PendingRevocation[] | undefined;

export interface PendingStoreOptions {
  session?: 'keep' | 'clear';
  /** After disposal, write only while the stored session is still this one. */
  disposeGuard?: CredentialRecordGuard;
  /** The write landed after its deadline had already answered for it. */
  onLateWrite?: () => void;
}

/** After disposal with no session to check, the slot must still hold what memory says waits. */
async function storedPendingIsOurs(runtime: AuthRuntime): Promise<boolean> {
  try {
    const stored = await withPortDeadline(
      runtime.dependencies.timer,
      DISPOSED_RECORD_READ_ATTEMPT_TIMEOUT_MS,
      () => runtime.dependencies.credentials.read(),
      PORT_OPERATION.CREDENTIALS_READ,
    );
    if (stored.kind !== 'found') return false;
    const read = readStoredValue(stored.value);
    if (read.kind !== 'read' || read.session !== undefined) return false;
    const held = pendingRevocations(runtime);
    return (
      read.pending.length === held.length &&
      read.pending.every((entry, index) => entry.refreshToken === held[index]?.refreshToken)
    );
  } catch {
    return false;
  }
}

/**
 * Changes what waits on the server in one queued step: the change runs against
 * the latest committed list, inside the storage queue, and its result is
 * written beside the session in one write. When the write did not happen,
 * memory keeps the list it had.
 */
export function updatePendingRevocations(
  runtime: AuthRuntime,
  change: PendingChange,
  options: PendingStoreOptions = {},
): Promise<PendingStoreResult> {
  const { session = 'keep', disposeGuard, onLateWrite } = options;
  let written = false;
  let unchanged = false;
  let abandoned = false;
  const pending = enqueueCredentialWrite(
    runtime,
    async () => {
      if (abandoned) return;
      // Learn what already waits first, so the disposal check below is the last await.
      if (!pendingKnown(runtime)) await ensurePendingKnown(runtime);
      if (runtime.disposed) {
        const ours = disposeGuard
          ? await matchesCredentialRecordGuard(runtime, disposeGuard)
          : await storedPendingIsOurs(runtime);
        if (!ours || abandoned) return;
      }
      const next = change(pendingRevocations(runtime));
      if (next === undefined) {
        unchanged = true;
        return;
      }
      const record = session === 'keep' ? runtime.record : undefined;
      await writeStoredValue(
        runtime,
        serializeStoredValue(record === undefined ? undefined : JSON.stringify(record), next),
      );
      written = true;
      holdPendingRevocations(runtime, next);
      if (abandoned) onLateWrite?.();
    },
    runtime.epoch,
    true,
  );
  return withPortDeadline(
    runtime.dependencies.timer,
    CREDENTIAL_WRITE_TIMEOUT_MS,
    () => pending,
    PORT_OPERATION.CREDENTIALS_REPLACE,
    () => {
      abandoned = true;
    },
  ).then(
    (): PendingStoreResult =>
      written
        ? { written: true }
        : unchanged
          ? { written: false, unchanged: true }
          : { written: false },
    (error: unknown): PendingStoreResult => ({
      written: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }),
  );
}

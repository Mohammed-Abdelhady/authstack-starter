import {
  AUTH_OPERATION,
  AUTH_REASON,
  PENDING_REVOCATION_END,
  REVOKE_OUTCOME,
  SESSION_STATUS,
} from '../constants';
import { recordEndedRevocation, updatePendingRevocations } from '../storage/pending-revocations';
import { createRevocationDrain, revocationKey, revokePending } from './revocation-retry';
import {
  drainedOutcome,
  readStoredToken,
  reservedIntent,
  withIntent,
  type SignedOutToken,
} from './sign-out-record';
import type { AuthRuntime } from '../runtime/runtime';
import type { CredentialRecordGuard } from '../storage/credential-record-store';
import type { ApiClient } from '@app/sdk';
import type { AbortSignalPort, AuthSnapshot, SignOutOutcome } from '../types/auth';
import type { PendingRevocation } from '../types/record';

/** What memory held when sign-out began, put back if the sign-out cannot be saved. */
interface HeldSession {
  tokens: AuthRuntime['tokens'];
  record: AuthRuntime['record'];
  before: AuthSnapshot;
}

export function createSignOutOperation(
  runtime: AuthRuntime,
  revocationClient: ApiClient<AbortSignalPort>,
) {
  const drain = createRevocationDrain(runtime, revocationClient);

  return (): Promise<SignOutOutcome> => {
    if (runtime.disposed) return Promise.resolve({ kind: 'disposed' });
    if (runtime.signOutPromise) return runtime.signOutPromise;
    const held: HeldSession = {
      tokens: runtime.tokens,
      record: runtime.record,
      before: runtime.snapshot,
    };
    const known: SignedOutToken = {
      refreshToken: held.tokens?.refreshToken ?? held.record?.tokens?.refreshToken,
      lineageId: held.tokens?.lineageId ?? held.record?.lineageId,
      proofKeyThumbprint: held.tokens?.proofKeyThumbprint ?? held.record?.proofKeyThumbprint,
      installDigest: runtime.installDigest ?? held.record?.installDigest,
    };
    if (known.refreshToken) runtime.markDisposedRevocationIntent(known.refreshToken);
    // A refresh still running writes nothing back once the epoch has moved on.
    const epoch = runtime.bumpEpoch('signOut');
    runtime.tokens = undefined;
    runtime.record = undefined;
    runtime.browserAbort?.abort();
    try {
      runtime.cancelAuthorizationDeadline?.();
    } catch {
      runtime.cancelAuthorizationDeadline = undefined;
    }
    runtime.cancelAuthorizationDeadline = undefined;
    const pending = runtime.raceWithDispose(
      Promise.resolve().then(() => finishSignOut(known, held, epoch)),
      () => ({ kind: 'disposed' as const }),
    );
    runtime.signOutPromise = pending;
    // A session in memory stays shown until its sign-out is saved.
    if (hasSession(held))
      runtime.setState(held.before.status, AUTH_OPERATION.SIGNING_OUT, snapshotFields(held.before));
    else runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.SIGNING_OUT);
    void pending.then(
      () => {
        if (runtime.signOutPromise === pending) runtime.signOutPromise = undefined;
      },
      () => {
        if (runtime.signOutPromise === pending) runtime.signOutPromise = undefined;
      },
    );
    return pending;
  };

  async function finishSignOut(
    known: SignedOutToken,
    held: HeldSession,
    epoch: number,
  ): Promise<SignOutOutcome> {
    let token = known;
    if (known.refreshToken === undefined && held.record === undefined) {
      token = await readStoredToken(runtime);
      if (!runtime.isEpochCurrent(epoch))
        return { kind: 'signedOut', revocation: 'recordUnavailable', error: token.readError };
    }
    if (!token.refreshToken) return signOutWithoutRevocation(epoch, token.readError);

    const refreshToken = token.refreshToken;
    const intent = reservedIntent(runtime, token, refreshToken);
    let dropped: PendingRevocation[] = [];
    const stored = await updatePendingRevocations(
      runtime,
      (list) => {
        const added = withIntent(list, intent);
        dropped = added.dropped;
        return added.next;
      },
      {
        session: 'clear',
        ...withGuard(disposeGuard(token)),
        onLateWrite: () => finishLateSignOut(held, intent),
      },
    );
    if (!stored.written) return notSaved(held, intent, epoch, stored.error);
    for (const entry of dropped)
      recordEndedRevocation(runtime, PENDING_REVOCATION_END.CAPACITY, entry.lineageId);
    runtime.deleteOwed = false;
    runtime.activeAuthorizationOperationId = undefined;
    if (runtime.isEpochCurrent(epoch))
      runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.SIGNING_OUT);
    const key = revocationKey(intent);
    const results = await drain(key);
    const result = results.get(key) ?? { outcome: REVOKE_OUTCOME.FAILED };
    forgetRevocationIntent(refreshToken);
    runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE);
    return result.error === undefined
      ? { kind: 'signedOut', revocation: result.outcome }
      : { kind: 'signedOut', revocation: result.outcome, error: result.error };
  }

  async function notSaved(
    held: HeldSession,
    intent: PendingRevocation,
    epoch: number,
    error: Error | undefined,
  ): Promise<SignOutOutcome> {
    // Once disposed, the person asked to sign out and never heard otherwise: a late
    // write of this token is still removed, and the server is asked once.
    if (runtime.disposed) {
      await revokePending(runtime, revocationClient, intent);
      return { kind: 'disposed' };
    }
    if (hasSession(held) && held.before.operation !== AUTH_OPERATION.NONE)
      return endLocally(intent, error);
    runtime.disposedRevocationIntents.delete(intent.refreshToken);
    if (runtime.isEpochCurrent(epoch)) keepSession(held);
    return error === undefined ? { kind: 'signOutNotSaved' } : { kind: 'signOutNotSaved', error };
  }

  /**
   * The sign-out began while a refresh or sign-in was writing tokens. That
   * operation has already seen the epoch move and revokes what it was issued,
   * and the server may have spent the token held here, so putting it back
   * would show a session with dead credentials. The session ends on this
   * device instead: the record is deleted at the next restore, and the server
   * is asked once to end the token held here.
   */
  async function endLocally(
    intent: PendingRevocation,
    error: Error | undefined,
  ): Promise<SignOutOutcome> {
    runtime.deleteOwed = true;
    runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.SIGNING_OUT, {
      warning: 'storageBlocked',
      reason: AUTH_REASON.STORAGE_FAILURE,
    });
    const result = await revokePending(runtime, revocationClient, intent);
    runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE, {
      warning: 'storageBlocked',
      reason: AUTH_REASON.STORAGE_FAILURE,
    });
    const reported = error ?? result.error;
    return reported === undefined
      ? { kind: 'signedOut', revocation: result.outcome }
      : { kind: 'signedOut', revocation: result.outcome, error: reported };
  }

  /** Nothing was written: the session in memory and on the device is as it was. */
  function keepSession(held: HeldSession): void {
    if (!hasSession(held)) {
      runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE, {
        warning: 'storageBlocked',
        reason: AUTH_REASON.STORAGE_FAILURE,
      });
      return;
    }
    runtime.tokens = held.tokens;
    runtime.record = held.record;
    runtime.setState(held.before.status, AUTH_OPERATION.NONE, snapshotFields(held.before));
  }

  /** The write landed after its deadline: the device says signed out, so memory follows. */
  function finishLateSignOut(held: HeldSession, intent: PendingRevocation): void {
    if (runtime.disposed || runtime.tokens !== held.tokens || runtime.record !== held.record)
      return;
    runtime.bumpEpoch('signOut');
    runtime.tokens = undefined;
    runtime.record = undefined;
    runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE);
    void drain(revocationKey(intent)).catch(() => undefined);
  }

  function disposeGuard(token: SignedOutToken): CredentialRecordGuard | undefined {
    if (!token.refreshToken || !token.installDigest) return undefined;
    return {
      kind: 'session',
      installDigest: token.installDigest,
      refreshToken: token.refreshToken,
      ...(token.lineageId === undefined ? {} : { lineageId: token.lineageId }),
    };
  }

  /** No token of its own: the session is removed, and what waits and is due is tried. */
  async function signOutWithoutRevocation(
    epoch: number,
    readError: Error | undefined,
  ): Promise<SignOutOutcome> {
    runtime.deleteOwed = true;
    const storageError = await runtime.deleteRecordGuarded(epoch).then(() => undefined, asError);
    const drained = drainedOutcome(await drain());
    runtime.setState(
      SESSION_STATUS.SIGNED_OUT,
      AUTH_OPERATION.NONE,
      storageError ? { warning: 'storageBlocked', reason: AUTH_REASON.STORAGE_FAILURE } : {},
    );
    const revocation = readError
      ? 'recordUnavailable'
      : (drained?.outcome ?? REVOKE_OUTCOME.NOT_NEEDED);
    const error = readError ?? storageError ?? drained?.error;
    return error === undefined
      ? { kind: 'signedOut', revocation }
      : { kind: 'signedOut', revocation, error };
  }

  function forgetRevocationIntent(refreshToken: string): void {
    void runtime.writeTail.then(() => {
      if (!runtime.disposed) runtime.disposedRevocationIntents.delete(refreshToken);
    });
  }
}

function hasSession(held: HeldSession): boolean {
  return held.tokens !== undefined || held.record !== undefined;
}

function withGuard(guard: CredentialRecordGuard | undefined) {
  return guard === undefined ? {} : { disposeGuard: guard };
}

function snapshotFields(snapshot: AuthSnapshot) {
  return {
    ...(snapshot.profile === undefined ? {} : { profile: snapshot.profile }),
    ...(snapshot.warning === undefined ? {} : { warning: snapshot.warning }),
    ...(snapshot.reason === undefined ? {} : { reason: snapshot.reason }),
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

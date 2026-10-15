import { REVOKE_RESULT, type RevokeResult } from '../constants';
import { sessionAlreadyEnded, uiApi } from './api';
import type { UiRuntime, UiStore } from './runtime';

type Runtime = Pick<UiRuntime, 'engine' | 'store' | 'epoch'>;
type Confirmation = () => Promise<boolean>;
const WRITING = new WeakSet<UiStore>();

async function write(
  runtime: Runtime,
  send: () => Promise<RevokeResult>,
  confirm?: Confirmation,
): Promise<RevokeResult> {
  const started = runtime.epoch.current();
  if (confirm !== undefined && !(await confirm())) return REVOKE_RESULT.CANCELLED;
  if (runtime.epoch.current() !== started) return REVOKE_RESULT.SUPERSEDED;
  // Inverse patches cannot safely undo overlapping removals of the same array.
  if (WRITING.has(runtime.store)) return REVOKE_RESULT.BUSY;
  WRITING.add(runtime.store);
  try {
    const result = await send();
    return runtime.epoch.current() === started ? result : REVOKE_RESULT.SUPERSEDED;
  } finally {
    WRITING.delete(runtime.store);
  }
}

/** This device signs out through the engine because the server refuses its revoke endpoint. */
async function signOutThisDevice(runtime: Runtime, confirm?: Confirmation): Promise<RevokeResult> {
  const started = runtime.epoch.current();
  if (confirm !== undefined && !(await confirm())) return REVOKE_RESULT.CANCELLED;
  if (runtime.epoch.current() !== started) return REVOKE_RESULT.SUPERSEDED;
  try {
    const outcome = await runtime.engine.signOut();
    // A sign-out that was not saved leaves this device signed in.
    return outcome.kind === 'signedOut' ? REVOKE_RESULT.SIGNED_OUT : REVOKE_RESULT.UNDONE;
  } catch {
    // Reported as not done, so the screen says the device is still signed in.
    return REVOKE_RESULT.UNDONE;
  }
}

export async function revokeSession(
  runtime: Runtime,
  session: { id: string; isCurrent: boolean },
  confirm?: Confirmation,
): Promise<RevokeResult> {
  if (session.isCurrent) return signOutThisDevice(runtime, confirm);
  return write(
    runtime,
    async () => {
      const result = await runtime.store.dispatch(
        uiApi.endpoints.revokeSession.initiate(session.id),
      );
      const refused = result.error !== undefined && !sessionAlreadyEnded(result.error);
      return refused ? REVOKE_RESULT.UNDONE : REVOKE_RESULT.REVOKED;
    },
    confirm,
  );
}

export async function revokeOtherSessions(
  runtime: Runtime,
  confirm?: Confirmation,
): Promise<RevokeResult> {
  return write(
    runtime,
    async () => {
      const result = await runtime.store.dispatch(uiApi.endpoints.revokeOtherSessions.initiate());
      return result.error === undefined ? REVOKE_RESULT.REVOKED : REVOKE_RESULT.UNDONE;
    },
    confirm,
  );
}

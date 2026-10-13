import { AUTH_OPERATION, AUTH_REASON, SESSION_STATUS } from '../constants';
import {
  CREDENTIAL_READ_TIMEOUT_MS,
  CRYPTO_DIGEST_TIMEOUT_MS,
  INSTALL_IDENTITY_TIMEOUT_MS,
  PORT_OPERATION,
  STORE_CONDITION,
} from '../constants';
import { storeCondition } from './credential-write';
import { withPortDeadline } from '../runtime/deadlines';
import { deviceKeyThumbprint } from '../proof/dpop-proof';
import { DeviceKeyAuthError } from '../errors/errors';
import { finishRestoreWithLaunchAddress } from '../sign-in/launch-address';
import {
  digestInstallIdentity,
  parseStoredRecord,
  recordMatches,
  transactionExpired,
} from './persistence';
import type { AuthRuntime } from '../runtime/runtime';
import { saveSessionAfterUnlock } from './session-save';
import type { RestoreOutcome } from '../types/auth';
import type { SignInController } from '../sign-in/sign-in';
import type { NativeController } from '../types/native-sign-in';

export function createRestoreOperation(
  runtime: AuthRuntime,
  signIn: SignInController,
  native: NativeController,
) {
  const restore = (): Promise<RestoreOutcome> => {
    if (runtime.disposed) return Promise.resolve({ kind: 'disposed' });
    if (runtime.restorePromise) return runtime.restorePromise;
    if (runtime.snapshot.status === SESSION_STATUS.SIGNED_IN && runtime.tokens) {
      const saving = saveSessionAfterUnlock(runtime);
      if (!saving) return Promise.resolve({ kind: 'restored', status: SESSION_STATUS.SIGNED_IN });
      return runtime.raceWithDispose(
        saving.then(() => ({ kind: 'restored' as const, status: runtime.snapshot.status })),
        () => ({ kind: 'disposed' as const }),
      );
    }
    if (runtime.snapshot.operation !== AUTH_OPERATION.NONE) {
      return Promise.resolve({ kind: 'restored', status: runtime.snapshot.status });
    }
    if (runtime.deleteOwed) return retryOwedDeletion();
    const profile = runtime.snapshot.profile;
    const epoch = runtime.bumpEpoch('restore');
    const pending = runtime.raceWithDispose(
      Promise.resolve().then(() => performRestore(epoch)),
      () => ({ kind: 'disposed' as const }),
    );
    runtime.restorePromise = pending;
    runtime.setState(
      SESSION_STATUS.RESTORING,
      AUTH_OPERATION.NONE,
      profile === undefined ? {} : { profile },
    );
    void pending.then(
      () => {
        if (runtime.restorePromise === pending) runtime.restorePromise = undefined;
      },
      () => {
        if (runtime.restorePromise === pending) runtime.restorePromise = undefined;
      },
    );
    return pending;
  };

  function retryOwedDeletion(): Promise<RestoreOutcome> {
    const epoch = runtime.bumpEpoch('restore');
    const pending = runtime.raceWithDispose(retryDeleteThenRestore(epoch), () => ({
      kind: 'disposed' as const,
    }));
    runtime.restorePromise = pending;
    runtime.setState(SESSION_STATUS.RESTORING, AUTH_OPERATION.NONE);
    void pending.then(
      () => {
        if (runtime.restorePromise === pending) runtime.restorePromise = undefined;
      },
      () => {
        if (runtime.restorePromise === pending) runtime.restorePromise = undefined;
      },
    );
    return pending;
  }

  async function retryDeleteThenRestore(epoch: number): Promise<RestoreOutcome> {
    try {
      const deleted = await runtime.deleteRecord(epoch);
      if (!runtime.isEpochCurrent(epoch))
        return { kind: 'restored', status: runtime.snapshot.status };
      if (!deleted) throw new Error('Credential deletion did not complete');
      return performRestore(epoch);
    } catch (error) {
      if (runtime.isEpochCurrent(epoch))
        runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
          reason: AUTH_REASON.STORAGE_FAILURE,
        });
      return { kind: 'storageBlocked', reason: storeCondition(error) };
    }
  }

  async function performRestore(epoch: number): Promise<RestoreOutcome> {
    if (!runtime.isEpochCurrent(epoch))
      return { kind: 'restored', status: runtime.snapshot.status };
    let identity;
    try {
      identity = await withPortDeadline(
        runtime.dependencies.timer,
        INSTALL_IDENTITY_TIMEOUT_MS,
        () => runtime.dependencies.install.identity(),
        PORT_OPERATION.INSTALL_IDENTITY,
      );
    } catch {
      identity = { kind: 'unavailable' as const };
    }
    if (!runtime.isEpochCurrent(epoch))
      return { kind: 'restored', status: runtime.snapshot.status };
    if (identity.kind !== 'found' || identity.id.length === 0) {
      runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
        reason: AUTH_REASON.STORAGE_FAILURE,
      });
      if (identity.kind === STORE_CONDITION.LOCKED)
        return { kind: 'storageBlocked', reason: STORE_CONDITION.LOCKED };
      return { kind: 'storageBlocked', reason: 'installUnavailable' };
    }
    try {
      runtime.installDigest = await withPortDeadline(
        runtime.dependencies.timer,
        CRYPTO_DIGEST_TIMEOUT_MS,
        () =>
          digestInstallIdentity(identity.id, runtime.config.clientId, runtime.dependencies.crypto),
        PORT_OPERATION.CRYPTO_SHA256,
      );
    } catch {
      if (!runtime.isEpochCurrent(epoch))
        return { kind: 'restored', status: runtime.snapshot.status };
      runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
        reason: AUTH_REASON.STORAGE_FAILURE,
      });
      return { kind: 'storageBlocked', reason: 'installUnavailable' };
    }
    let stored;
    try {
      stored = await withPortDeadline(
        runtime.dependencies.timer,
        CREDENTIAL_READ_TIMEOUT_MS,
        () => runtime.dependencies.credentials.read(),
        PORT_OPERATION.CREDENTIALS_READ,
      );
    } catch {
      stored = { kind: 'unavailable' as const };
    }
    if (!runtime.isEpochCurrent(epoch))
      return { kind: 'restored', status: runtime.snapshot.status };
    if (stored.kind === 'locked' || stored.kind === 'cancelled' || stored.kind === 'unavailable') {
      runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
        reason: AUTH_REASON.STORAGE_FAILURE,
      });
      return { kind: 'storageBlocked', reason: stored.kind };
    }
    if (stored.kind === 'missing') {
      runtime.record = undefined;
      runtime.tokens = undefined;
      runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE);
      return finishRestoreWithLaunchAddress(runtime, signIn);
    }
    if (stored.kind === 'corrupt') {
      return deleteInvalidRecord(runtime, epoch, AUTH_REASON.INVALID_RECORD);
    }
    const record = parseStoredRecord(stored.value);
    if (!record) return deleteInvalidRecord(runtime, epoch, AUTH_REASON.INVALID_RECORD);
    if (!recordMatches(record, runtime.config, runtime.installDigest)) {
      const reason =
        record.installDigest === runtime.installDigest
          ? AUTH_REASON.INVALID_RECORD
          : AUTH_REASON.INSTALL_MISMATCH;
      return deleteInvalidRecord(runtime, epoch, reason);
    }
    if (record.tokens && record.lineageId === undefined) {
      runtime.record = record;
      runtime.tokens = undefined;
      runtime.setState(SESSION_STATUS.REAUTH_REQUIRED, AUTH_OPERATION.NONE, {
        reason: AUTH_REASON.INVALID_RECORD,
      });
      return { kind: 'restored', status: runtime.snapshot.status };
    }
    runtime.record = record;
    if (record.refreshInFlight) {
      runtime.tokens = undefined;
      runtime.setState(SESSION_STATUS.REAUTH_REQUIRED, AUTH_OPERATION.NONE, {
        reason: AUTH_REASON.REFRESH_INTERRUPTED,
      });
      return { kind: 'restored', status: runtime.snapshot.status };
    }
    if (record.tokens) {
      if (record.proofKeyThumbprint !== undefined) {
        if (!runtime.dependencies.deviceKey) {
          runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
            reason: AUTH_REASON.DEVICE_KEY_UNAVAILABLE,
          });
          return { kind: 'storageBlocked', reason: 'deviceKeyUnavailable' };
        }
        let currentThumbprint: string;
        try {
          currentThumbprint = await deviceKeyThumbprint(runtime.dependencies);
        } catch (error) {
          if (!runtime.isEpochCurrent(epoch))
            return { kind: 'restored', status: runtime.snapshot.status };
          if (!(error instanceof DeviceKeyAuthError) || error.reason === 'unavailable') {
            runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
              reason: AUTH_REASON.DEVICE_KEY_UNAVAILABLE,
            });
            return { kind: 'storageBlocked', reason: 'deviceKeyUnavailable' };
          }
          runtime.tokens = undefined;
          runtime.setState(SESSION_STATUS.REAUTH_REQUIRED, AUTH_OPERATION.NONE, {
            reason: AUTH_REASON.DEVICE_KEY_INVALIDATED,
          });
          return { kind: 'restored', status: runtime.snapshot.status };
        }
        if (!runtime.isEpochCurrent(epoch))
          return { kind: 'restored', status: runtime.snapshot.status };
        if (currentThumbprint !== record.proofKeyThumbprint) {
          runtime.tokens = undefined;
          runtime.setState(SESSION_STATUS.REAUTH_REQUIRED, AUTH_OPERATION.NONE, {
            reason: AUTH_REASON.DEVICE_KEY_INVALIDATED,
          });
          return { kind: 'restored', status: runtime.snapshot.status };
        }
      }
      let monotonicTime: number;
      try {
        monotonicTime = runtime.monotonicTime();
      } catch {
        runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
          reason: AUTH_REASON.STORAGE_FAILURE,
        });
        return { kind: 'storageBlocked', reason: 'unavailable' };
      }
      runtime.installTokens(
        '',
        record.tokens.refreshToken,
        monotonicTime,
        0,
        record.lineageId,
        record.proofKeyThumbprint,
      );
      runtime.setState(SESSION_STATUS.SIGNED_IN, AUTH_OPERATION.NONE, {
        profile: runtime.snapshot.profile,
      });
      return finishRestoreWithLaunchAddress(runtime, signIn);
    }
    if (record.transaction) {
      let wallTime: number;
      try {
        wallTime = runtime.wallTime();
      } catch {
        runtime.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
          reason: AUTH_REASON.STORAGE_FAILURE,
        });
        return { kind: 'storageBlocked', reason: 'unavailable' };
      }
      if (transactionExpired(record.transaction, wallTime)) {
        return deleteInvalidRecord(runtime, epoch, AUTH_REASON.INVALID_RECORD);
      }
      runtime.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE);
      if (record.nativeAttempt) {
        await native.restore(epoch);
        return finishRestoreWithLaunchAddress(runtime, native);
      }
      return finishRestoreWithLaunchAddress(runtime, signIn);
    }
    return deleteInvalidRecord(runtime, epoch, AUTH_REASON.INVALID_RECORD);
  }

  async function deleteInvalidRecord(
    runtimeValue: AuthRuntime,
    epoch: number,
    reason: 'invalidRecord' | 'installMismatch',
  ): Promise<RestoreOutcome> {
    try {
      const deleted = await runtimeValue.deleteRecord(epoch);
      if (!deleted) return { kind: 'restored', status: runtimeValue.snapshot.status };
    } catch (error) {
      if (!runtimeValue.isEpochCurrent(epoch))
        return { kind: 'restored', status: runtimeValue.snapshot.status };
      runtimeValue.setState(SESSION_STATUS.STORAGE_BLOCKED, AUTH_OPERATION.NONE, {
        reason: AUTH_REASON.STORAGE_FAILURE,
      });
      return { kind: 'storageBlocked', reason: storeCondition(error) };
    }
    runtimeValue.record = undefined;
    runtimeValue.tokens = undefined;
    runtimeValue.setState(SESSION_STATUS.SIGNED_OUT, AUTH_OPERATION.NONE, { reason });
    return finishRestoreWithLaunchAddress(runtimeValue, signIn);
  }

  return restore;
}

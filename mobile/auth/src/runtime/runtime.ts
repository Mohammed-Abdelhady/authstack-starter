import type { Transport } from '@app/sdk';
import { ACCESS_TOKEN_SAFETY_MARGIN_MS, AUTH_OPERATION } from '../constants';
import type {
  AuthConfiguration,
  AuthDependencies,
  AbortSignalPort,
  AuthOperation,
  AuthSnapshot,
  SessionStatus,
  TimerPort,
  Unsubscribe,
} from '../types/auth';
import type { AuthRecord, RuntimeTokens, StoredAuthRecord } from '../types/record';
import { AuthPortError } from '../errors/errors';
import { freezeSnapshot, sameSnapshot } from './snapshot';
import { DisposeListeners } from './dispose-listeners';
import {
  deleteCredentialRecord,
  enqueueCredentialWrite,
  replaceCredentialRecord,
} from '../storage/credential-record-store';
import type {
  CredentialRecordGuard,
  LateWriteCorrection,
} from '../storage/credential-record-store';

export type { CredentialRecordGuard } from '../storage/credential-record-store';

export type EpochChangeReason = 'signIn' | 'restore' | 'signOut' | 'dispose' | 'sessionEnded';

export class AuthRuntime {
  readonly rawTransport: Transport<AbortSignalPort>;
  readonly listeners = new Set<(snapshot: AuthSnapshot) => void>();
  readonly epochListeners = new Set<(reason: EpochChangeReason) => void>();
  readonly disposedRevocationIntents = new Set<string>();
  readonly snapshotQueue: AuthSnapshot[] = [];
  config: AuthConfiguration;
  snapshot: AuthSnapshot = freezeSnapshot({ status: 'restoring', operation: 'none' });
  record: StoredAuthRecord | undefined;
  installDigest: string | undefined;
  tokens: RuntimeTokens | undefined;
  epoch = 0;
  tokenVersion = 0;
  lastOAuthTokenSentAt: number | undefined;
  oauthTokenRequestSent = false;
  writeTail: Promise<void> = Promise.resolve();
  publishing = false;
  disposed = false;
  signInPromise: Promise<import('../types/auth').SignInOutcome> | undefined;
  refreshThrottleUntil: number | undefined;
  deleteOwed = false;
  preserveSessionOnDispose = false;
  preserveSignOutOnDispose = false;
  restorePromise: Promise<import('../types/auth').RestoreOutcome> | undefined;
  unsubscribeCallbacks: Unsubscribe | undefined;
  initialAddressRead = false;
  initialAddressPending: Promise<import('../types/auth').LaunchAddressResult> | undefined;
  sessionSave: Promise<void> | undefined;
  operationSequence = 0;
  activeAuthorizationOperationId: string | undefined;
  cancelAuthorizationDeadline: Unsubscribe | undefined;
  browserAbort: { abort(): void } | undefined;
  signOutPromise: Promise<import('../types/auth').SignOutOutcome> | undefined;
  private readonly disposeListeners = new DisposeListeners();
  private readonly scheduledCallbacks = new Map<Unsubscribe, () => void>();

  constructor(configuration: AuthConfiguration, dependencies: AuthDependencies) {
    this.config = configuration;
    const timer: TimerPort = {
      after: (milliseconds, callback) => {
        let completed = false;
        let cancel: Unsubscribe = () => undefined;
        const trackedCallback = (): void => {
          if (completed) return;
          completed = true;
          this.scheduledCallbacks.delete(cancel);
          callback();
        };
        const cancelPortTimer = dependencies.timer.after(milliseconds, trackedCallback);
        cancel = () => {
          completed = true;
          this.scheduledCallbacks.delete(cancel);
          cancelPortTimer();
        };
        if (!completed) this.scheduledCallbacks.set(cancel, trackedCallback);
        return cancel;
      },
    };
    this.dependencies = { ...dependencies, timer };
    this.rawTransport = dependencies.makeTransport(configuration.serverBaseAddress);
  }

  readonly dependencies: AuthDependencies;

  get disposeListenerCount(): number {
    return this.disposeListeners.size;
  }

  onDispose(listener: () => void): Unsubscribe {
    return this.disposeListeners.subscribe(listener);
  }

  markDisposedRevocationIntent(refreshToken: string): boolean {
    if (this.disposedRevocationIntents.has(refreshToken)) return false;
    this.disposedRevocationIntents.add(refreshToken);
    return true;
  }

  raceWithDispose<T, R>(pending: Promise<T>, disposedResult: () => R): Promise<T | R> {
    return this.disposeListeners.race(pending, disposedResult);
  }

  subscribe(listener: (snapshot: AuthSnapshot) => void): Unsubscribe {
    this.listeners.add(listener);
    try {
      listener(this.snapshot);
    } catch (error) {
      this.listeners.delete(listener);
      throw error;
    }
    return () => this.listeners.delete(listener);
  }

  setState(
    status: SessionStatus,
    operation: AuthOperation,
    extras: Pick<AuthSnapshot, 'reason' | 'warning' | 'profile' | 'nativeAttempt'> = {},
  ): void {
    const next = freezeSnapshot({ status, operation, ...extras });
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = next;
    this.snapshotQueue.push(next);
    if (this.publishing) return;
    this.publishing = true;
    try {
      while (this.snapshotQueue.length > 0) {
        const current = this.snapshotQueue.shift();
        if (!current) continue;
        for (const listener of [...this.listeners]) {
          try {
            listener(current);
          } catch {
            continue;
          }
        }
      }
    } finally {
      this.publishing = false;
    }
  }

  enqueueWrite(
    action: () => Promise<void>,
    expectedEpoch: number,
    allowStale = false,
  ): Promise<boolean> {
    return enqueueCredentialWrite(this, action, expectedEpoch, allowStale);
  }

  replaceRecord(
    record: AuthRecord,
    expectedEpoch = this.epoch,
    lateCorrection: LateWriteCorrection = { kind: 'replace', record },
    disposeGuard?: CredentialRecordGuard,
  ): Promise<boolean> {
    return replaceCredentialRecord(this, record, expectedEpoch, lateCorrection, disposeGuard);
  }

  deleteRecord(expectedEpoch = this.epoch): Promise<boolean> {
    return this.deleteRecordGuarded(expectedEpoch);
  }

  deleteRecordGuarded(
    expectedEpoch: number,
    disposeGuard?: CredentialRecordGuard,
  ): Promise<boolean> {
    return deleteCredentialRecord(this, expectedEpoch, disposeGuard);
  }

  nextOperationId(): string {
    this.operationSequence += 1;
    return `${this.epoch}-${this.operationSequence}`;
  }

  wallTime(): number {
    try {
      return this.dependencies.clock.wallTime();
    } catch (error) {
      throw new AuthPortError('clock.wallTime', 'failed', error);
    }
  }

  monotonicTime(): number {
    try {
      const value = this.dependencies.clock.monotonicTime();
      if (!Number.isFinite(value))
        throw new TypeError('The monotonic clock must return a finite number');
      return value;
    } catch (error) {
      throw new AuthPortError('clock.monotonicTime', 'failed', error);
    }
  }

  installTokens(
    accessToken: string,
    refreshToken: string,
    sentAt: number,
    expiresIn: number,
    lineageId: string,
    proofKeyThumbprint?: string,
  ): RuntimeTokens {
    this.tokenVersion += 1;
    const next: RuntimeTokens = {
      accessToken,
      refreshToken,
      version: this.tokenVersion,
      expiresAt: sentAt + expiresIn * 1000 - ACCESS_TOKEN_SAFETY_MARGIN_MS,
      lineageId,
      ...(proofKeyThumbprint === undefined ? {} : { proofKeyThumbprint }),
    };
    this.tokens = next;
    return next;
  }

  isEpochCurrent(epoch: number): boolean {
    return this.epoch === epoch;
  }

  bumpEpoch(reason: EpochChangeReason = 'sessionEnded'): number {
    this.epoch += 1;
    this.signInPromise = undefined;
    this.restorePromise = undefined;
    this.refreshThrottleUntil = undefined;
    for (const listener of [...this.epochListeners]) {
      try {
        listener(reason);
      } catch {
        continue;
      }
    }
    return this.epoch;
  }

  onEpochChange(listener: (reason: EpochChangeReason) => void): Unsubscribe {
    this.epochListeners.add(listener);
    return () => this.epochListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    const discardTransientRecord =
      this.snapshot.operation === 'authorizing' ||
      (this.snapshot.operation === 'exchanging' && !this.record?.tokens);
    const transactionOperationId =
      this.activeAuthorizationOperationId ??
      this.record?.transaction?.operationId ??
      this.record?.authorizationOperationId;
    let transientGuard: CredentialRecordGuard | undefined;
    if (discardTransientRecord && this.record?.tokens) {
      transientGuard = {
        kind: 'session',
        installDigest: this.record.installDigest,
        refreshToken: this.record.tokens.refreshToken,
        ...(this.record.lineageId === undefined ? {} : { lineageId: this.record.lineageId }),
      };
    } else if (discardTransientRecord && transactionOperationId) {
      transientGuard = { kind: 'authorization', operationId: transactionOperationId };
    }
    this.preserveSessionOnDispose =
      this.snapshot.operation === 'refreshing' && this.tokens !== undefined;
    this.preserveSignOutOnDispose =
      this.snapshot.operation === AUTH_OPERATION.SIGNING_OUT && this.signOutPromise !== undefined;
    this.disposed = true;
    this.disposeListeners.notify();
    this.bumpEpoch('dispose');
    this.tokens = undefined;
    if (discardTransientRecord && transientGuard) {
      this.record = undefined;
      this.deleteOwed = true;
    }
    this.browserAbort?.abort();
    this.browserAbort = undefined;
    try {
      this.cancelAuthorizationDeadline?.();
    } catch {
      this.cancelAuthorizationDeadline = undefined;
    }
    this.cancelAuthorizationDeadline = undefined;
    for (const [cancel, callback] of [...this.scheduledCallbacks]) {
      if (this.preserveSessionOnDispose || this.preserveSignOutOnDispose) continue;
      try {
        callback();
      } catch {
        continue;
      }
      try {
        cancel();
      } catch {
        // The scheduled callback still settles the operation when a cancel port fails.
      }
    }
    try {
      this.unsubscribeCallbacks?.();
    } catch {
      this.unsubscribeCallbacks = undefined;
    }
    this.listeners.clear();
    this.epochListeners.clear();
    this.setState('signedOut', 'none');
    if (transientGuard)
      void this.deleteRecordGuarded(this.epoch, transientGuard).catch(() => undefined);
  }
}

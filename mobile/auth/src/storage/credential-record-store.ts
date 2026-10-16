import {
  CREDENTIAL_DELETE_TIMEOUT_MS,
  CREDENTIAL_WRITE_TIMEOUT_MS,
  DISPOSED_RECORD_OWNER,
  DISPOSED_RECORD_READ_ATTEMPTS,
  DISPOSED_RECORD_READ_ATTEMPT_TIMEOUT_MS,
  PORT_OPERATION,
} from '../constants';
import { deleteStoredRecord, replaceStoredRecord } from './credential-write';
import { withPortDeadline } from '../runtime/deadlines';
import { recordMatches } from './persistence';
import { readStoredValue } from './envelope';
import type { AuthRuntime } from '../runtime/runtime';
import type { AuthRecord } from '../types/record';

export type CredentialRecordGuard =
  | { kind: 'authorization'; operationId: string }
  | {
      kind: 'session';
      installDigest: string;
      refreshToken: string;
      lineageId?: string;
      sentRefreshToken?: string;
    }
  | { kind: 'refresh'; installDigest: string; refreshToken: string; lineageId?: string };

export type DisposedRecordOwner =
  (typeof DISPOSED_RECORD_OWNER)[keyof typeof DISPOSED_RECORD_OWNER];

export type LateWriteCorrection = { kind: 'delete' } | { kind: 'replace'; record: AuthRecord };

export function enqueueCredentialWrite(
  runtime: AuthRuntime,
  action: () => Promise<void>,
  expectedEpoch: number,
  allowStale = false,
): Promise<boolean> {
  const result = runtime.writeTail.then(async () => {
    if (!allowStale && expectedEpoch !== runtime.epoch) return false;
    await action();
    return expectedEpoch === runtime.epoch;
  });
  runtime.writeTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function replaceCredentialRecord(
  runtime: AuthRuntime,
  record: AuthRecord,
  expectedEpoch: number,
  lateCorrection: LateWriteCorrection,
  disposeGuard = guardForRecord(record),
): Promise<boolean> {
  const serialized = JSON.stringify(record);
  if (record.transaction) runtime.activeAuthorizationOperationId = record.transaction.operationId;
  else if (record.authorizationOperationId)
    runtime.activeAuthorizationOperationId = record.authorizationOperationId;
  let abandoned = false;
  let written = false;
  const pending = enqueueCredentialWrite(
    runtime,
    async () => {
      if (runtime.disposed) {
        if (
          !disposeGuard ||
          !(await matchesCredentialRecordGuard(runtime, disposeGuard)) ||
          abandoned
        )
          return;
      }
      await replaceStoredRecord(runtime, serialized);
      written = true;
      if (expectedEpoch !== runtime.epoch) {
        const recordGuard = guardForRecord(record);
        if (runtime.disposed && abandoned && recordGuard) {
          const owner = await classifyDisposedCredentialRecord(runtime, recordGuard);
          const token = record.tokens?.refreshToken;
          if (
            owner === DISPOSED_RECORD_OWNER.OWN_SAME &&
            token !== undefined &&
            !runtime.disposedRevocationIntents.has(token)
          )
            return;
          if (
            owner === DISPOSED_RECORD_OWNER.UNREADABLE &&
            record.refreshInFlight &&
            token !== undefined &&
            !runtime.disposedRevocationIntents.has(token)
          )
            return;
        }
        const correction =
          runtime.record === undefined || (runtime.disposed && abandoned)
            ? { kind: 'delete' as const }
            : lateCorrection;
        await applyLateCorrection(
          runtime,
          correction,
          expectedEpoch,
          correction.kind === 'delete' ? recordGuard : disposeGuard,
        );
        return;
      }
      if (abandoned) {
        const recordGuard = guardForRecord(record);
        if (runtime.disposed && recordGuard) {
          const owner = await classifyDisposedCredentialRecord(runtime, recordGuard);
          const token = record.tokens?.refreshToken;
          if (
            owner === DISPOSED_RECORD_OWNER.OWN_SAME &&
            token !== undefined &&
            !runtime.disposedRevocationIntents.has(token)
          )
            return;
        }
        const correction =
          runtime.disposed && abandoned ? { kind: 'delete' as const } : lateCorrection;
        await applyLateCorrection(
          runtime,
          correction,
          expectedEpoch,
          correction.kind === 'delete' ? recordGuard : disposeGuard,
        );
        return;
      }
      runtime.record = record;
      runtime.deleteOwed = false;
      if (record.transaction)
        runtime.activeAuthorizationOperationId = record.transaction.operationId;
      else if (record.authorizationOperationId)
        runtime.activeAuthorizationOperationId = record.authorizationOperationId;
    },
    expectedEpoch,
  );
  const operation = withPortDeadline(
    runtime.dependencies.timer,
    CREDENTIAL_WRITE_TIMEOUT_MS,
    () => pending,
    PORT_OPERATION.CREDENTIALS_REPLACE,
    () => {
      abandoned = true;
    },
  );
  return operation.then((current) => current && written);
}

export function deleteCredentialRecord(
  runtime: AuthRuntime,
  expectedEpoch: number,
  disposeGuard?: CredentialRecordGuard,
): Promise<boolean> {
  let abandoned = false;
  let deleted = false;
  const pending = enqueueCredentialWrite(
    runtime,
    async () => {
      if (runtime.disposed) {
        if (
          !disposeGuard ||
          !(await matchesCredentialRecordGuard(runtime, disposeGuard)) ||
          abandoned
        )
          return;
      }
      if (abandoned) return;
      await deleteStoredRecord(runtime);
      deleted = true;
      runtime.deleteOwed = false;
      runtime.activeAuthorizationOperationId = undefined;
      if (expectedEpoch === runtime.epoch || runtime.record === undefined)
        runtime.record = undefined;
    },
    expectedEpoch,
    true,
  );
  const operation = withPortDeadline(
    runtime.dependencies.timer,
    CREDENTIAL_DELETE_TIMEOUT_MS,
    () => pending,
    PORT_OPERATION.CREDENTIALS_DELETE,
    () => {
      abandoned = true;
    },
  );
  return operation.then((current) => current && deleted);
}

function guardForRecord(record: AuthRecord): CredentialRecordGuard | undefined {
  const operationId = record.authorizationOperationId ?? record.transaction?.operationId;
  if (operationId) return { kind: 'authorization', operationId };
  const refreshToken = record.tokens?.refreshToken;
  if (refreshToken) {
    const session = {
      installDigest: record.installDigest,
      refreshToken,
      ...(record.lineageId === undefined ? {} : { lineageId: record.lineageId }),
    };
    return record.refreshInFlight
      ? { kind: 'refresh', ...session }
      : { kind: 'session', ...session };
  }
  return undefined;
}

async function applyLateCorrection(
  runtime: AuthRuntime,
  correction: LateWriteCorrection,
  expectedEpoch: number,
  disposeGuard?: CredentialRecordGuard,
): Promise<void> {
  if (runtime.disposed && correction.kind === 'replace') return;
  let abandoned = false;
  const write = Promise.resolve().then(async () => {
    if (runtime.disposed) {
      if (
        !disposeGuard ||
        !(await matchesCredentialRecordGuard(runtime, disposeGuard)) ||
        abandoned
      )
        return false;
    }
    if (abandoned) return false;
    if (correction.kind === 'delete') await deleteStoredRecord(runtime);
    else await replaceStoredRecord(runtime, JSON.stringify(correction.record));
    return true;
  });
  let corrected = false;
  try {
    await withPortDeadline(
      runtime.dependencies.timer,
      correction.kind === 'delete' ? CREDENTIAL_DELETE_TIMEOUT_MS : CREDENTIAL_WRITE_TIMEOUT_MS,
      () => write,
      correction.kind === 'delete'
        ? PORT_OPERATION.CREDENTIALS_DELETE
        : PORT_OPERATION.CREDENTIALS_REPLACE,
      () => {
        abandoned = true;
      },
    );
    corrected = await write;
  } catch {
    corrected = await write.then(
      (written) => written,
      () => false,
    );
  }
  if (!corrected || !runtime.isEpochCurrent(expectedEpoch)) return;
  runtime.record = correction.kind === 'delete' ? undefined : correction.record;
}

export async function matchesCredentialRecordGuard(
  runtime: AuthRuntime,
  guard: CredentialRecordGuard,
): Promise<boolean> {
  return (
    (await classifyDisposedCredentialRecord(runtime, guard)) === DISPOSED_RECORD_OWNER.OWN_SAME
  );
}

export async function classifyDisposedCredentialRecord(
  runtime: AuthRuntime,
  guard: CredentialRecordGuard,
): Promise<DisposedRecordOwner> {
  for (let attempt = 0; attempt < DISPOSED_RECORD_READ_ATTEMPTS; attempt += 1) {
    try {
      const stored = await withPortDeadline(
        runtime.dependencies.timer,
        DISPOSED_RECORD_READ_ATTEMPT_TIMEOUT_MS,
        () => runtime.dependencies.credentials.read(),
        PORT_OPERATION.CREDENTIALS_READ,
      );
      if (stored.kind === 'missing') return DISPOSED_RECORD_OWNER.EMPTY;
      if (stored.kind !== 'found') continue;
      const read = readStoredValue(stored.value);
      if (read.kind !== 'read') continue;
      // A value that holds only revocations waiting on the server has no session.
      if (read.session === undefined) return DISPOSED_RECORD_OWNER.EMPTY;
      const record = read.session;
      const digest =
        guard.kind === 'authorization' ? (runtime.installDigest ?? '') : guard.installDigest;
      if (!recordMatches(record, runtime.config, digest)) return DISPOSED_RECORD_OWNER.FOREIGN;
      if (guard.kind === 'authorization') {
        const operationId = record.authorizationOperationId ?? record.transaction?.operationId;
        return operationId === guard.operationId
          ? DISPOSED_RECORD_OWNER.OWN_SAME
          : DISPOSED_RECORD_OWNER.FOREIGN;
      }
      if (record.installDigest !== guard.installDigest || record.tokens?.refreshToken === undefined)
        return DISPOSED_RECORD_OWNER.FOREIGN;
      if (guard.lineageId === undefined || record.lineageId === undefined)
        return DISPOSED_RECORD_OWNER.FOREIGN;
      const lineageMatches = record.lineageId === guard.lineageId;
      if (guard.kind === 'refresh') {
        if (
          lineageMatches &&
          record.tokens.refreshToken === guard.refreshToken &&
          record.refreshInFlight === true
        )
          return DISPOSED_RECORD_OWNER.OWN_SAME;
      } else if (lineageMatches && record.tokens.refreshToken === guard.refreshToken) {
        return DISPOSED_RECORD_OWNER.OWN_SAME;
      }
      if (
        record.lineageId === guard.lineageId &&
        record.tokens.refreshToken !==
          (guard.kind === 'session' ? guard.sentRefreshToken : undefined) &&
        record.transaction === undefined &&
        record.authorizationOperationId === undefined
      )
        return DISPOSED_RECORD_OWNER.OWN_OTHER;
      return DISPOSED_RECORD_OWNER.FOREIGN;
    } catch {
      continue;
    }
  }
  return DISPOSED_RECORD_OWNER.UNREADABLE;
}

import { CREDENTIAL_WRITE_DONE, PORT_OPERATION, STORE_CONDITION } from '../constants';
import { CredentialStoreError, type CredentialStoreCondition } from '../errors/errors';
import type { AuthRuntime } from '../runtime/runtime';
import type { CredentialWriteResult } from '../types/auth';
import { serializeStoredValue } from './envelope';
import { pendingRevocations } from './pending-revocations';

// A refused write is thrown, so every path that handled a failed write still does.
function expectDone(result: CredentialWriteResult, operation: string): void {
  if (result.kind !== CREDENTIAL_WRITE_DONE) throw new CredentialStoreError(operation, result.kind);
}

// Each write is one hop to the port, as before: callers count on when its deadline clears.
async function replaceValue(runtime: AuthRuntime, value: string): Promise<void> {
  expectDone(
    await runtime.dependencies.credentials.replace(value),
    PORT_OPERATION.CREDENTIALS_REPLACE,
  );
}

async function deleteValue(runtime: AuthRuntime): Promise<void> {
  expectDone(await runtime.dependencies.credentials.delete(), PORT_OPERATION.CREDENTIALS_DELETE);
}

/** Stores `value`, or clears the slot when there is nothing to keep. */
export function writeStoredValue(runtime: AuthRuntime, value: string | undefined): Promise<void> {
  return value === undefined ? deleteValue(runtime) : replaceValue(runtime, value);
}

/**
 * A session write keeps whatever still waits on the server beside it. The
 * engine only writes a session after restore has read the slot (it starts as
 * restoring and refuses to sign in before), so the list in memory is current.
 */
export function replaceStoredRecord(runtime: AuthRuntime, value: string): Promise<void> {
  return replaceValue(runtime, serializeStoredValue(value, pendingRevocations(runtime)) ?? value);
}

/** Removing the session keeps the revocations that wait; the slot empties with neither. */
export function deleteStoredRecord(runtime: AuthRuntime): Promise<void> {
  return writeStoredValue(runtime, serializeStoredValue(undefined, pendingRevocations(runtime)));
}

/** Why a write did not happen, for an outcome. An unknown failure reads as unavailable. */
export function storeCondition(error: unknown): CredentialStoreCondition {
  return error instanceof CredentialStoreError ? error.condition : STORE_CONDITION.UNAVAILABLE;
}

export function isStoreLocked(error: unknown): boolean {
  return storeCondition(error) === STORE_CONDITION.LOCKED;
}

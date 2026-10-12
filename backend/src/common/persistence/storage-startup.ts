/** The store is not what this build needs. The message says what to do. */
export class StorageNotReadyError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'StorageNotReadyError';
  }
}

/**
 * What the store has to be before the application serves: its unique rules and
 * indexes in place, and its schema at the version this build expects.
 *
 * The application calls `prepare` once at boot, before anything else reads or
 * writes. Whether an adapter may bring the store up to date itself, or only
 * checks and refuses, is that adapter's rule and is written on the adapter. A
 * refusal is a `StorageNotReadyError` that tells the operator what to run.
 */
export abstract class StorageStartup {
  abstract prepare(): Promise<void>;
}

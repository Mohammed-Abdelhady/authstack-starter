import { SdkError } from '@app/sdk';
import type { CredentialWriteResult, DeviceKeyFailure } from '../types/auth';

export type AuthPortFailureReason = 'timedOut' | 'failed';

export class AuthPortError extends SdkError {
  constructor(
    readonly operation: string,
    readonly reason: AuthPortFailureReason,
    cause?: unknown,
  ) {
    super(`Native auth port ${operation} ${reason}`, { cause });
    this.name = 'AuthPortError';
  }
}

export type CredentialStoreCondition = Exclude<CredentialWriteResult['kind'], 'done'>;

/** A write or delete the store refused. `condition` is the reason the adapter gave. */
export class CredentialStoreError extends AuthPortError {
  constructor(
    operation: string,
    readonly condition: CredentialStoreCondition,
  ) {
    super(operation, 'failed');
    this.name = 'CredentialStoreError';
  }
}

export function authPortFailure(error: unknown, operation: string): AuthPortError {
  return error instanceof AuthPortError ? error : new AuthPortError(operation, 'failed', error);
}

export class AuthSessionError extends SdkError {
  constructor(message = 'Authentication is required') {
    super(message);
    this.name = 'AuthSessionError';
  }
}

export class UnsafeRequestPathError extends SdkError {
  constructor() {
    super('The native auth transport refused an unsafe request path');
    this.name = 'UnsafeRequestPathError';
  }
}

export class AuthDisposedError extends SdkError {
  constructor() {
    super('The authentication engine has been disposed');
    this.name = 'AuthDisposedError';
  }
}

export type DeviceKeyErrorReason = DeviceKeyFailure['kind'] | 'thumbprintMismatch';

export class DeviceKeyAuthError extends SdkError {
  constructor(
    readonly reason: DeviceKeyErrorReason,
    cause?: unknown,
  ) {
    super(`Device key operation failed: ${reason}`, { cause });
    this.name = 'DeviceKeyAuthError';
  }
}

export class DeviceBindingRequiredError extends SdkError {
  constructor(readonly errorDescription: string) {
    super(errorDescription);
    this.name = 'DeviceBindingRequiredError';
  }
}

/** The server kept challenging the proof, and no request it could have acted on was sent. */
export class DpopChallengeLimitError extends SdkError {
  constructor(cause: unknown) {
    super('The server challenged every DPoP proof', { cause });
    this.name = 'DpopChallengeLimitError';
  }
}

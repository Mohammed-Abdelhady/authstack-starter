import type { OperationHandle } from './types';
import { SdkError } from '../errors';

export type { OperationHandle } from './types';

interface UuidPort {
  randomUUID(): string;
}

function isUuidPort(value: unknown): value is UuidPort {
  return (
    typeof value === 'object' &&
    value !== null &&
    'randomUUID' in value &&
    typeof value.randomUUID === 'function'
  );
}

function secureOperationKey(): string {
  const cryptoPort: unknown = Reflect.get(globalThis, 'crypto');
  if (!isUuidPort(cryptoPort)) throw new SdkError('Secure UUID generation is unavailable');
  return cryptoPort.randomUUID();
}

export function createOperationHandle(
  createKey: () => string = secureOperationKey,
): OperationHandle {
  // Not sent yet; kept for reconciling an unknown outcome.
  return { operationKey: createKey() };
}

import type { OperationHandle } from './types';
import { SdkError } from '../errors';

export type { OperationHandle } from './types';

const UUID_BYTE_COUNT = 16;
/** RFC 9562 version 4: byte 6 starts with the nibble 4 and byte 8 with the bits 10. */
const UUID_V4_BITS: ReadonlyMap<number, { keep: number; set: number }> = new Map([
  [6, { keep: 0x0f, set: 0x40 }],
  [8, { keep: 0x3f, set: 0x80 }],
]);

interface UuidPort {
  randomUUID(): string;
}

interface RandomValuesPort {
  getRandomValues(array: Uint8Array): unknown;
}

function isUuidPort(value: unknown): value is UuidPort {
  return (
    typeof value === 'object' &&
    value !== null &&
    'randomUUID' in value &&
    typeof value.randomUUID === 'function'
  );
}

function isRandomValuesPort(value: unknown): value is RandomValuesPort {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getRandomValues' in value &&
    typeof value.getRandomValues === 'function'
  );
}

function uuidFromRandomValues(port: RandomValuesPort): string {
  const bytes = new Uint8Array(UUID_BYTE_COUNT);
  port.getRandomValues(bytes);
  const hex = Array.from(bytes, (byte, index) => {
    const bits = UUID_V4_BITS.get(index);
    const value = bits ? (byte & bits.keep) | bits.set : byte;
    return value.toString(16).padStart(2, '0');
  }).join('');
  return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

// randomUUID needs a secure context; getRandomValues also works on plain HTTP.
function secureOperationKey(): string {
  const cryptoPort: unknown = Reflect.get(globalThis, 'crypto');
  if (isUuidPort(cryptoPort)) return cryptoPort.randomUUID();
  if (isRandomValuesPort(cryptoPort)) return uuidFromRandomValues(cryptoPort);
  throw new SdkError('Secure UUID generation is unavailable');
}

export function createOperationHandle(
  createKey: () => string = secureOperationKey,
): OperationHandle {
  // Not sent yet; kept for reconciling an unknown outcome.
  return { operationKey: createKey() };
}

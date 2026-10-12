import { unwrapEnvelope } from '../envelope';
import type { TransportResponse } from '../transport';
import type {
  NativeAttemptResult,
  NativeAttemptStartResult,
  NativeMethods,
  NativePasskeyOptions,
} from '../types/native-auth';
import { parseAttemptResult, parseStartResult } from './attempt-parser';
import { parseNativeMethods } from './methods-parser';
import { parsePasskeyOptions } from './passkey-parser';

export function unwrapNativeMethods(response: TransportResponse): NativeMethods {
  return parseNativeMethods(unwrapEnvelope<unknown>(response), response.status);
}

export function unwrapNativeAttemptResult(response: TransportResponse): NativeAttemptResult {
  return parseAttemptResult(unwrapEnvelope<unknown>(response), response.status);
}

export function unwrapNativeAttemptStart(response: TransportResponse): NativeAttemptStartResult {
  return parseStartResult(unwrapEnvelope<unknown>(response), response.status);
}

export function unwrapNativePasskeyOptions(response: TransportResponse): NativePasskeyOptions {
  return parsePasskeyOptions(unwrapEnvelope<unknown>(response), response.status);
}

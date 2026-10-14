import type { NativePromptResult } from '@app/native-auth';

interface NativeErrorFields {
  code?: unknown;
  name?: unknown;
  message?: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isNonceDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

export function promptFailure<T>(reason: 'sdk' | 'invalidResponse'): NativePromptResult<T> {
  return { kind: 'failed', reason };
}

export function errorHasCode(error: unknown, codes: readonly string[]): boolean {
  if (!isRecord(error)) return false;
  const fields: NativeErrorFields = error;
  const candidates = [fields.code, fields.name, fields.message];
  return candidates.some((candidate) =>
    typeof candidate === 'string'
      ? codes.includes(candidate) || codes.some((code) => candidate.startsWith(`${code}:`))
      : false,
  );
}

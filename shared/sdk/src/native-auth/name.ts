import { NATIVE_AUTH_LIMITS } from '@app/core';

export function normalizeNativeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().normalize('NFC');
  const characters = Array.from(name).length;
  return characters > 0 && characters <= NATIVE_AUTH_LIMITS.NAME ? name : undefined;
}

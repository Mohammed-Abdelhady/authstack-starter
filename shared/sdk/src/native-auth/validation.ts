import { NATIVE_AUTH_LIMITS, NATIVE_AUTH_PATTERN } from '@app/core';
import { malformedResponse } from '../envelope';
import { requireArray } from '../shapes';

export type JsonObject = Record<string, unknown>;

export function fail(status: number, field: string, expectation: string): never {
  throw malformedResponse(status, `The response is malformed: ${field} ${expectation}`);
}

export function exactKeys(
  value: JsonObject,
  keys: readonly string[],
  field: string,
  status: number,
): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(status, `${field}.${key}`, 'is not supported');
  }
}

export function boundedString(
  value: unknown,
  field: string,
  limit: number,
  status: number,
  pattern?: RegExp,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    return fail(status, field, 'is not a non-empty string');
  }
  if (value.length > limit) fail(status, field, 'is too long');
  if (pattern !== undefined && !pattern.test(value)) fail(status, field, 'has an invalid format');
  return value;
}

export function booleanValue(value: unknown, field: string, status: number): boolean {
  if (typeof value !== 'boolean') fail(status, field, 'is not a boolean');
  return value;
}

export function boundedStringList(
  value: unknown,
  field: string,
  itemLimit: number,
  countLimit: number,
  status: number,
): string[] {
  const items = requireArray(value, field, status);
  if (items.length > countLimit) fail(status, field, 'has too many items');
  return items.map((item, index) => boundedString(item, `${field}[${index}]`, itemLimit, status));
}

export function isoDate(value: unknown, field: string, status: number): string {
  const date = boundedString(
    value,
    field,
    NATIVE_AUTH_LIMITS.ISO_DATE,
    status,
    NATIVE_AUTH_PATTERN.ISO_DATE,
  );
  if (!Number.isFinite(Date.parse(date))) fail(status, field, 'is not a valid date');
  return date;
}

export function email(value: unknown, field: string, status: number): string {
  return boundedString(value, field, NATIVE_AUTH_LIMITS.EMAIL, status, NATIVE_AUTH_PATTERN.EMAIL);
}

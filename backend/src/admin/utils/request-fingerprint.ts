import { createHash } from 'node:crypto';

/** Body fields left out of a fingerprint, so no secret is hashed into a stored record. */
const UNHASHED_FIELDS = new Set(['password']);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  const entries = Object.entries(value)
    .filter(([key, field]) => field !== undefined && !UNHASHED_FIELDS.has(key))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, field]) => [key, canonical(field)]);
  return Object.fromEntries(entries);
}

/**
 * SHA-256 of the operation and the body with its keys sorted, so the same
 * request in another key order matches and any changed value does not.
 */
export function requestFingerprint(operation: string, body: unknown): string {
  return createHash('sha256')
    .update(operation)
    .update('\n')
    .update(JSON.stringify(canonical(body)) ?? 'undefined')
    .digest('hex');
}

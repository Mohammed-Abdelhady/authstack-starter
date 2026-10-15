import { ValidationFailedException } from '../../../common/exceptions/validation-failed.exception';
import {
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  ACTIVITY_MAX_PAGE,
  ACTIVITY_MAX_OFFSET,
  ACTIVITY_FILTER_PATTERN,
} from '../constants/activity-details';
import { ActivityQuery } from '../types/activity-event';

const QUERY_KEYS = ['page', 'limit', 'from', 'to', 'actor', 'action', 'target'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function invalidQuery(): never {
  throw new ValidationFailedException(
    { query: ['Invalid activity query'] },
    { fieldNames: ['query'], omittedCount: 0 },
  );
}

function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' && typeof value !== 'string')
    return invalidQuery();
  if (typeof value === 'string' && !/^\d+$/.test(value)) return invalidQuery();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max)
    return invalidQuery();
  return parsed;
}

function filter(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ACTIVITY_FILTER_PATTERN.test(value))
    return invalidQuery();
  return value;
}

function date(value: unknown): Date | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value))
    return invalidQuery();
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    return invalidQuery();
  }
  return parsed;
}

export function activityQuery(input: unknown): ActivityQuery {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    return invalidQuery();
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    return invalidQuery();
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      typeof key !== 'string' ||
      !QUERY_KEYS.includes(key) ||
      !descriptor ||
      !('value' in descriptor)
    )
      return invalidQuery();
  }
  const page = integer(Reflect.get(input, 'page'), 1, ACTIVITY_MAX_PAGE);
  const limit = integer(
    Reflect.get(input, 'limit'),
    ACTIVITY_DEFAULT_LIMIT,
    ACTIVITY_MAX_LIMIT,
  );
  if ((page - 1) * limit > ACTIVITY_MAX_OFFSET) return invalidQuery();
  const from = date(Reflect.get(input, 'from'));
  const to = date(Reflect.get(input, 'to'));
  if (from && to && from >= to) return invalidQuery();
  return {
    page,
    limit,
    from,
    to,
    actor: filter(Reflect.get(input, 'actor')),
    action: filter(Reflect.get(input, 'action')),
    target: filter(Reflect.get(input, 'target')),
  };
}

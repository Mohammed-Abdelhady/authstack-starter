/** Names an error and one cause by sanitized name and code, never by message. */
const LOGGABLE_ERROR_TOKEN_PATTERN = /^[A-Za-z0-9_.]{1,60}$/;
const UNPRINTABLE_ERROR_TOKEN = 'unprintable';

export function errorToken(value: unknown, allowNumber = false): string {
  if (allowNumber && typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' && LOGGABLE_ERROR_TOKEN_PATTERN.test(value)
    ? value
    : UNPRINTABLE_ERROR_TOKEN;
}

export function describeDriverError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const facts = error as { name?: unknown; code?: unknown };
    const name = errorToken(facts.name);
    if (typeof facts.code === 'undefined') {
      return describeCause(error, `name=${name}`);
    }
    return describeCause(
      error,
      `name=${name} code=${errorToken(facts.code, true)}`,
    );
  }
  return `non-object ${typeof error}`;
}

function describeCause(error: object, summary: string): string {
  if (
    !('cause' in error) ||
    error.cause === undefined ||
    error.cause === error
  ) {
    return summary;
  }
  const cause = error.cause;
  if (typeof cause !== 'object' || cause === null) {
    return `${summary} cause=non-object ${typeof cause}`;
  }
  const facts = cause as { name?: unknown; code?: unknown };
  const name = errorToken(facts.name);
  return typeof facts.code === 'undefined'
    ? `${summary} cause=name=${name}`
    : `${summary} cause=name=${name} code=${errorToken(facts.code, true)}`;
}

import { getSystemErrorMap } from 'node:util';

/** SQLSTATE codes the server gives a meaning to. No driver is loaded to read one. */
export const SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  INVALID_TEXT_REPRESENTATION: '22P02',
  IN_FAILED_SQL_TRANSACTION: '25P02',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
  ADMIN_SHUTDOWN: '57P01',
  CRASH_SHUTDOWN: '57P02',
  CANNOT_CONNECT_NOW: '57P03',
  TOO_MANY_CONNECTIONS: '53300',
} as const;

/**
 * Five digits or capitals, at least one of them a digit, as every state the
 * server defines has. Capitals alone are no state: `EPIPE` is five of them.
 */
const SQLSTATE_PATTERN = /^(?=[A-Z]*[0-9])[0-9A-Z]{5}$/;

/**
 * The operating system's error names. The driver passes a socket failure
 * through with its name in `code`, the field the server's state arrives in.
 */
const SYSTEM_ERROR_NAMES: ReadonlySet<string> = new Set(
  [...getSystemErrorMap().values()].map(([name]) => name),
);

/** A text field of a failure, when it has one. */
export function failureText(error: object, field: string): string | undefined {
  const value: unknown = Reflect.get(error, field);
  return typeof value === 'string' ? value : undefined;
}

/** The server's SQLSTATE, when a SQL server is the one that answered. */
export function sqlStateOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code = failureText(error, 'code');
  if (code === undefined || !SQLSTATE_PATTERN.test(code)) {
    return undefined;
  }
  return SYSTEM_ERROR_NAMES.has(code) ? undefined : code;
}

/** The server routine that reads text as a uuid. Every uuid column is an id. */
const UUID_INPUT_ROUTINE = 'string_to_uuid';

/**
 * True when the server refused a value it was reading as an id. SQLSTATE 22P02
 * alone is any text the server could not read as its type, a number or a
 * boolean included, and those are faults, not bad ids.
 */
export function isRefusedId(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    sqlStateOf(error) === SQLSTATE.INVALID_TEXT_REPRESENTATION &&
    failureText(error, 'routine') === UUID_INPUT_ROUTINE
  );
}

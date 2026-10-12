import {
  MalformedIdError,
  PersistenceTimeoutError,
  PersistenceUnavailableError,
  RetryableAbortError,
  UniqueConflictError,
} from '../persistence-errors';
import {
  isRefusedId,
  failureText,
  SQLSTATE,
  sqlStateOf,
} from '../../utils/sql-state.util';
import {
  DRIVER_TIMEOUT_MESSAGES,
  DRIVER_UNAVAILABLE_MESSAGES,
} from './postgres-driver-failures';
import { ROLE_CONSTRAINT } from '../../../role/stores/role-records';
import { ISSUANCE_CONSTRAINT } from '../../../session/issuance/browser-issuance.store';

export { SQLSTATE, sqlStateOf };

const CONNECTION_EXCEPTION_CLASS = '08';

const RETRYABLE_STATES: ReadonlySet<string> = new Set([
  SQLSTATE.SERIALIZATION_FAILURE,
  SQLSTATE.DEADLOCK_DETECTED,
  SQLSTATE.LOCK_NOT_AVAILABLE,
]);

const UNAVAILABLE_STATES: ReadonlySet<string> = new Set([
  SQLSTATE.ADMIN_SHUTDOWN,
  SQLSTATE.CRASH_SHUTDOWN,
  SQLSTATE.CANNOT_CONNECT_NOW,
  SQLSTATE.TOO_MANY_CONNECTIONS,
]);

/** Socket failures the driver passes through with Node's own code. */
const UNAVAILABLE_SOCKET_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'EHOSTUNREACH',
]);

const TIMEOUT_SOCKET_CODES: ReadonlySet<string> = new Set(['ETIMEDOUT']);

/** Constraint name to the rule's shared name. An unlisted one keeps its own. */
const POSTGRES_CONSTRAINTS: Readonly<Record<string, string>> = {
  security_event_id_unique: ISSUANCE_CONSTRAINT.SECURITY_EVENT_ID,
  session_token_hash_unique: ISSUANCE_CONSTRAINT.SESSION_TOKEN_HASH,
  grant_user_client_unique: ISSUANCE_CONSTRAINT.GRANT_USER_CLIENT,
  role_slug_unique: ROLE_CONSTRAINT.SLUG,
};

const UNNAMED_CONSTRAINT = 'unnamed';

function constraintOf(error: object): string {
  const name = failureText(error, 'constraint');
  if (!name) {
    return UNNAMED_CONSTRAINT;
  }
  return POSTGRES_CONSTRAINTS[name] ?? name;
}

function mapSqlState(state: string, error: object): unknown {
  if (state === SQLSTATE.UNIQUE_VIOLATION) {
    return new UniqueConflictError(constraintOf(error), error);
  }
  if (isRefusedId(error)) {
    return new MalformedIdError(error);
  }
  if (RETRYABLE_STATES.has(state)) {
    return new RetryableAbortError(error);
  }
  if (state === SQLSTATE.QUERY_CANCELED) {
    return new PersistenceTimeoutError(error);
  }
  if (isUnavailableState(state)) {
    return new PersistenceUnavailableError(error);
  }
  return error;
}

function isUnavailableState(state: string): boolean {
  return (
    state.startsWith(CONNECTION_EXCEPTION_CLASS) ||
    UNAVAILABLE_STATES.has(state)
  );
}

/**
 * True when the connection a statement failed on must not serve another: the
 * server did not answer the statement, or answered that the session is over.
 */
export function endsSession(failure: unknown): boolean {
  const state = sqlStateOf(failure);
  return state === undefined || isUnavailableState(state);
}

/**
 * The shared error for a driver failure. Anything else, an application error or
 * one that is already shared, comes back as it went in.
 */
export function mapPostgresError(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) {
    return error;
  }
  const state = sqlStateOf(error);
  if (state !== undefined) {
    return mapSqlState(state, error);
  }
  const socketCode = failureText(error, 'code');
  if (socketCode === undefined) {
    return mapCodelessFailure(error);
  }
  if (TIMEOUT_SOCKET_CODES.has(socketCode)) {
    return new PersistenceTimeoutError(error);
  }
  if (UNAVAILABLE_SOCKET_CODES.has(socketCode)) {
    return new PersistenceUnavailableError(error);
  }
  return error;
}

/** The driver's own failures, which carry a message and nothing else. */
function mapCodelessFailure(error: object): unknown {
  const message = failureText(error, 'message');
  if (message === undefined) {
    return error;
  }
  if (DRIVER_TIMEOUT_MESSAGES.has(message)) {
    return new PersistenceTimeoutError(error);
  }
  if (DRIVER_UNAVAILABLE_MESSAGES.has(message)) {
    return new PersistenceUnavailableError(error);
  }
  return error;
}

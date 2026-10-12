/**
 * Failures the driver raises as a plain `Error` with no code and no class of
 * its own, so the message is all there is to tell them by. The spec beside
 * this file reads the installed driver and fails when one no longer appears.
 */
export const DRIVER_FAILURE = {
  /** pg-pool `index.js`, `connect`: no connection came free in time. */
  POOL_WAIT_TIMEOUT: 'timeout exceeded when trying to connect',
  /** pg-pool `index.js`, `newClient`: a new connection was not made in time. */
  CONNECT_TIMEOUT: 'Connection terminated due to connection timeout',
  /** pg `lib/client.js`, `query`: no answer within `query_timeout`. */
  QUERY_READ_TIMEOUT: 'Query read timeout',
  /** pg `lib/client.js`, `_connect`: the socket closed unasked. */
  CONNECTION_TERMINATED: 'Connection terminated unexpectedly',
  /** pg `lib/client.js`, `query`: sent on a connection that had failed. */
  NOT_QUERYABLE:
    'Client has encountered a connection error and is not queryable',
} as const;

export const DRIVER_TIMEOUT_MESSAGES: ReadonlySet<string> = new Set([
  DRIVER_FAILURE.POOL_WAIT_TIMEOUT,
  DRIVER_FAILURE.CONNECT_TIMEOUT,
  DRIVER_FAILURE.QUERY_READ_TIMEOUT,
]);

export const DRIVER_UNAVAILABLE_MESSAGES: ReadonlySet<string> = new Set([
  DRIVER_FAILURE.CONNECTION_TERMINATED,
  DRIVER_FAILURE.NOT_QUERYABLE,
]);

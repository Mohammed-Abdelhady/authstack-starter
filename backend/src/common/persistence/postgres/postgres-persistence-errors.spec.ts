import { DatabaseError } from 'pg';
import {
  PersistenceTimeoutError,
  PersistenceUnavailableError,
  RetryableAbortError,
  UniqueConflictError,
} from '../persistence-errors';
import {
  endsSession,
  mapPostgresError,
  sqlStateOf,
} from './postgres-persistence-errors';
import { systemError } from './session-loss.harness-spec';

/** A server answer with the fields the driver's parser sets on every one. */
function serverError(code: string, severity = 'ERROR'): DatabaseError {
  const error = new DatabaseError('the server refused', 120, 'error');
  error.severity = severity;
  error.code = code;
  return error;
}

const codeOnly = (code: string): Error =>
  Object.assign(new Error('failed'), { code });

type Shared = abstract new (...args: never[]) => Error;

describe('the shared error for a PostgreSQL driver failure', () => {
  const mapped: Array<[string, () => Error, Shared]> = [
    [
      'a broken pipe from the socket',
      () => systemError('EPIPE', 'write'),
      PersistenceUnavailableError,
    ],
    [
      'a broken pipe known by its code alone',
      () => codeOnly('EPIPE'),
      PersistenceUnavailableError,
    ],
    [
      'a reset connection',
      () => systemError('ECONNRESET', 'read'),
      PersistenceUnavailableError,
    ],
    [
      'a refused connection',
      () => systemError('ECONNREFUSED', 'connect'),
      PersistenceUnavailableError,
    ],
    [
      'a socket that timed out',
      () => systemError('ETIMEDOUT', 'connect'),
      PersistenceTimeoutError,
    ],
    [
      'a wait for a free connection that ran out',
      () => new Error('timeout exceeded when trying to connect'),
      PersistenceTimeoutError,
    ],
    [
      'a new connection that was not made in time',
      () => new Error('Connection terminated due to connection timeout'),
      PersistenceTimeoutError,
    ],
    [
      'a statement the server never answered',
      () => new Error('Query read timeout'),
      PersistenceTimeoutError,
    ],
    [
      'a socket that closed unasked',
      () => new Error('Connection terminated unexpectedly'),
      PersistenceUnavailableError,
    ],
    [
      'a statement sent on a connection that had failed',
      () =>
        new Error(
          'Client has encountered a connection error and is not queryable',
        ),
      PersistenceUnavailableError,
    ],
    ['a unique violation', () => serverError('23505'), UniqueConflictError],
    [
      'a serialization failure',
      () => serverError('40001'),
      RetryableAbortError,
    ],
    [
      'a session the administrator ended',
      () => serverError('57P01', 'FATAL'),
      PersistenceUnavailableError,
    ],
  ];

  it.each(mapped)('maps %s', (_, raise, shared) => {
    const raised = raise();

    const error = mapPostgresError(raised);

    expect({
      shared: error instanceof shared,
      cause: error instanceof Error ? error.cause === raised : false,
    }).toEqual({ shared: true, cause: true });
  });

  it.each([
    ['five capitals that are no state and no socket code', codeOnly('ABCDE')],
    ['a system error that is no socket failure', systemError('E2BIG', 'spawn')],
    ['a driver message it does not know', new Error('Connection terminated')],
    [
      'a known message on an error that has a code of its own',
      Object.assign(new Error('Query read timeout'), { code: 'ERR_OTHER' }),
    ],
  ])('hands back %s as it came', (_, raised) => {
    expect(mapPostgresError(raised)).toBe(raised);
  });

  it('reads a SQLSTATE only from a code the server could have sent', () => {
    const read = [
      serverError('23505'),
      serverError('40P01'),
      codeOnly('57P01'),
      systemError('EPIPE', 'write'),
      codeOnly('EPIPE'),
      systemError('E2BIG', 'spawn'),
      codeOnly('ABCDE'),
      codeOnly('2350'),
      codeOnly('235050'),
      codeOnly('23p05'),
      Object.assign(new Error('failed'), { code: 23505 }),
      new Error('no code'),
      'text',
      null,
    ].map((failure) => sqlStateOf(failure) ?? 'none');

    expect(read).toEqual([
      '23505',
      '40P01',
      '57P01',
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
    ]);
  });

  it('keeps a connection only after a failure the session answered and survived', () => {
    const spent = [
      serverError('23505'),
      serverError('40001'),
      serverError('57014'),
      serverError('57P01', 'FATAL'),
      serverError('08006', 'FATAL'),
      systemError('EPIPE', 'write'),
      new Error('Query read timeout'),
    ].map((failure) => endsSession(failure));

    expect(spent).toEqual([false, false, false, true, true, true, true]);
  });
});

import { HttpStatus } from '@nestjs/common';
import { DatabaseError } from 'pg';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import {
  MalformedIdError,
  PersistenceTimeoutError,
  PersistenceUnavailableError,
  RetryableAbortError,
  UniqueConflictError,
  UnknownTransactionOutcomeError,
} from '../../../common/persistence/persistence-errors';
import { mapPostgresError } from '../../../common/persistence/postgres/postgres-persistence-errors';

function serverError(code: string, constraint?: string): DatabaseError {
  const error = new DatabaseError('server refused', 14, 'error');
  error.code = code;
  error.constraint = constraint;
  return error;
}

function socketError(code: string): Error {
  return Object.assign(new Error('socket failed'), { code });
}

describe('mapPostgresError', () => {
  it.each([
    [
      'the security event id',
      'security_event_id_unique',
      'security_event.event_id',
    ],
    [
      'the session token hash',
      'session_token_hash_unique',
      'session.token_hash',
    ],
    [
      'the grant per user and client',
      'grant_user_client_unique',
      'grant.user_client',
    ],
    ['a constraint with no shared name', 'users_email_key', 'users_email_key'],
    ['no constraint name', undefined, 'unnamed'],
  ])(
    'maps a unique violation on %s to a unique conflict naming the rule',
    (_, stored, constraint) => {
      const driverError = serverError('23505', stored);

      const mapped = mapPostgresError(driverError);

      expect({
        shared: mapped instanceof UniqueConflictError,
        constraint:
          mapped instanceof UniqueConflictError ? mapped.constraint : null,
        cause: mapped instanceof Error ? mapped.cause === driverError : false,
      }).toEqual({ shared: true, constraint, cause: true });
    },
  );

  it.each([
    [
      'a failed id cast to a malformed id',
      () => Object.assign(serverError('22P02'), { routine: 'string_to_uuid' }),
      MalformedIdError,
    ],
    [
      'text the server could not read as a number, left as raised',
      () => Object.assign(serverError('22P02'), { routine: 'boolin' }),
      DatabaseError,
    ],
    [
      'a lock that is not available to a retryable abort',
      () => serverError('55P03'),
      RetryableAbortError,
    ],
    [
      'a serialization failure to a retryable abort',
      () => serverError('40001'),
      RetryableAbortError,
    ],
    [
      'a deadlock to a retryable abort',
      () => serverError('40P01'),
      RetryableAbortError,
    ],
    [
      'a cancelled statement to a timeout',
      () => serverError('57014'),
      PersistenceTimeoutError,
    ],
    [
      'a socket timeout to a timeout',
      () => socketError('ETIMEDOUT'),
      PersistenceTimeoutError,
    ],
    [
      'a connection failure state to unavailable',
      () => serverError('08006'),
      PersistenceUnavailableError,
    ],
    [
      'an administrator shutdown to unavailable',
      () => serverError('57P01'),
      PersistenceUnavailableError,
    ],
    [
      'a server that is starting up to unavailable',
      () => serverError('57P03'),
      PersistenceUnavailableError,
    ],
    [
      'too many connections to unavailable',
      () => serverError('53300'),
      PersistenceUnavailableError,
    ],
    [
      'a refused connection to unavailable',
      () => socketError('ECONNREFUSED'),
      PersistenceUnavailableError,
    ],
    [
      'a reset connection to unavailable',
      () => socketError('ECONNRESET'),
      PersistenceUnavailableError,
    ],
  ])('maps %s', (_, driverError, shared) => {
    expect(mapPostgresError(driverError())).toBeInstanceOf(shared);
  });

  it.each([
    [
      'an application error',
      new AppException(ErrorCode.USER_NOT_FOUND, 'gone', HttpStatus.NOT_FOUND),
    ],
    ['an error that is already shared', new MalformedIdError()],
    ['an unknown commit outcome', new UnknownTransactionOutcomeError(null)],
    ['a server error with no shared meaning', serverError('42P01')],
    ['an ordinary error', new Error('unrelated')],
    ['a value that is not an error', 'text'],
    ['nothing', undefined],
  ])('hands back %s as it came', (_, error) => {
    expect(mapPostgresError(error)).toBe(error);
  });
});

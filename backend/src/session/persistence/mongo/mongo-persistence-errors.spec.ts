import { HttpStatus } from '@nestjs/common';
import { MongoNetworkError, MongoServerError } from 'mongodb';
import { Error as MongooseError } from 'mongoose';
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
import { mapMongoError } from './mongo-persistence-errors';

function duplicateKey(index: string): MongoServerError {
  return new MongoServerError({
    code: 11000,
    message: `E11000 duplicate key error collection: app.things index: ${index} dup key: { key: "value" }`,
  });
}

function serverError(code: number, labels: string[] = []): MongoServerError {
  const error = new MongoServerError({ code, message: 'server refused' });
  for (const label of labels) error.addErrorLabel(label);
  return error;
}

describe('mapMongoError', () => {
  it.each([
    ['the security event id', 'eventId_1', 'security_event.event_id'],
    ['the session token hash', 'tokenHash_unique', 'session.token_hash'],
    [
      'the grant per user and client',
      'grant_user_client_unique',
      'grant.user_client',
    ],
    ['an index with no shared name', 'email_1', 'email_1'],
  ])(
    'maps a duplicate key on %s to a unique conflict naming the rule',
    (_, index, constraint) => {
      const driverError = duplicateKey(index);

      const mapped = mapMongoError(driverError);

      expect({
        shared: mapped instanceof UniqueConflictError,
        constraint:
          mapped instanceof UniqueConflictError ? mapped.constraint : null,
        cause: mapped instanceof Error ? mapped.cause === driverError : false,
      }).toEqual({ shared: true, constraint, cause: true });
    },
  );

  it('names a duplicate key whose message carries no index as unnamed', () => {
    const mapped = mapMongoError(
      new MongoServerError({ code: 11000, message: 'E11000 duplicate key' }),
    );

    expect(
      mapped instanceof UniqueConflictError ? mapped.constraint : null,
    ).toBe('unnamed');
  });

  it.each([
    [
      'a cast error to a malformed id',
      () => new MongooseError.CastError('ObjectId', 'nope', '_id'),
      MalformedIdError,
    ],
    [
      'a write conflict labelled transient to a retryable abort',
      () => serverError(112, ['TransientTransactionError']),
      RetryableAbortError,
    ],
    [
      'an expired time limit to a timeout',
      () => serverError(50),
      PersistenceTimeoutError,
    ],
    [
      'an exceeded time limit to a timeout',
      () => serverError(262),
      PersistenceTimeoutError,
    ],
    [
      'a primary that stepped down to unavailable',
      () => serverError(189),
      PersistenceUnavailableError,
    ],
    [
      'a network failure to unavailable',
      () => new MongoNetworkError('socket closed'),
      PersistenceUnavailableError,
    ],
    [
      'a failed server selection to unavailable',
      () => new MongooseError.MongooseServerSelectionError('no primary'),
      PersistenceUnavailableError,
    ],
  ])('maps %s', (_, driverError, shared) => {
    expect(mapMongoError(driverError())).toBeInstanceOf(shared);
  });

  it.each([
    [
      'an application error',
      new AppException(ErrorCode.USER_NOT_FOUND, 'gone', HttpStatus.NOT_FOUND),
    ],
    ['an error that is already shared', new MalformedIdError()],
    ['an unknown commit outcome', new UnknownTransactionOutcomeError(null)],
    ['a server error with no shared meaning', serverError(2)],
    ['an ordinary error', new Error('unrelated')],
    ['a value that is not an error', 'text'],
    ['nothing', undefined],
  ])('hands back %s as it came', (_, error) => {
    expect(mapMongoError(error)).toBe(error);
  });
});

import { ArgumentsHost, Logger } from '@nestjs/common';
import {
  createArgumentsHostMock,
  createRequestMock,
} from '../testing/test-doubles.harness-spec';
import { GlobalExceptionFilter } from './global-exception.filter';

const REQUEST_ID = 'request-9';
const ADDRESS = 'secret@example.com';

/** What a SQL driver raises, as far as the filter reads it: no driver is loaded. */
function sqlFailure(code: string, message: string, constraint?: string): Error {
  return Object.assign(new Error(message), {
    name: 'DatabaseError',
    code,
    constraint,
  });
}

/** What MongoDB raises for a refused unique rule, by shape. */
function duplicateKey(key: string, value: string): Error {
  return Object.assign(new Error(`E11000 duplicate key error ${key}`), {
    name: 'MongoServerError',
    code: 11000,
    keyPattern: { [key]: 1 },
    keyValue: { [key]: value },
  });
}

/**
 * A service that leaves failures as raised hands the filter the driver's own
 * error. These are the answers for the SQL ones, next to the answers MongoDB's
 * get, which must be the same.
 */
describe('GlobalExceptionFilter answers to raw SQL failures', () => {
  const filter = new GlobalExceptionFilter();
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function answerTo(exception: unknown): unknown {
    const json = jest.fn().mockReturnThis();
    const status = jest.fn().mockReturnValue({ json });
    const host: ArgumentsHost = createArgumentsHostMock({
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => ({ status, json }),
        getRequest: () => createRequestMock({ requestId: REQUEST_ID }),
      }),
    });

    filter.catch(exception, host);

    const [[body]]: unknown[][] = json.mock.calls;
    const error: unknown = Reflect.get(Object(body), 'error');
    const [[sent]]: unknown[][] = status.mock.calls;
    return {
      status: sent,
      code: Reflect.get(Object(error), 'code'),
      message: Reflect.get(Object(error), 'message'),
    };
  }

  function logged(): string {
    return [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call: unknown[]) => call.map((part) => String(part)).join(' '))
      .join('\n');
  }

  it('answers a taken address as it answers the MongoDB duplicate key', () => {
    const taken = {
      status: 409,
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'Email already registered',
    };

    expect({
      sql: answerTo(
        sqlFailure(
          '23505',
          `duplicate key value violates unique constraint "user_email_unique" Key (email)=(${ADDRESS})`,
          'user_email_unique',
        ),
      ),
      mongo: answerTo(duplicateKey('email', ADDRESS)),
    }).toEqual({ sql: taken, mongo: taken });
  });

  it('answers any other refused unique rule as a conflict, like MongoDB', () => {
    const conflict = {
      status: 409,
      code: 'CONFLICT',
      message: 'Resource conflict occurred',
    };

    expect({
      sql: answerTo(
        sqlFailure(
          '23505',
          'duplicate key value violates unique constraint "role_slug_unique"',
          'role_slug_unique',
        ),
      ),
      unnamed: answerTo(sqlFailure('23505', 'duplicate key value')),
      mongo: answerTo(duplicateKey('slug', 'editor')),
    }).toEqual({ sql: conflict, unnamed: conflict, mongo: conflict });
  });

  it('answers a value the database refused as an id as invalid input', () => {
    expect(
      answerTo(
        Object.assign(
          sqlFailure(
            '22P02',
            'invalid input syntax for type uuid: "not-an-id"',
          ),
          { routine: 'string_to_uuid' },
        ),
      ),
    ).toEqual({
      status: 400,
      code: 'INVALID_INPUT',
      message: 'Invalid input',
    });
  });

  it.each([
    ['a number', 'pg_strtoint32_safe'],
    ['a boolean', 'boolin'],
    ['no named routine', undefined],
  ])(
    'answers text the database could not read as %s as an unexpected error',
    (_, routine) => {
      const fault = Object.assign(
        sqlFailure('22P02', 'invalid input syntax for type integer: "x"'),
        { routine },
      );

      expect({
        answer: answerTo(fault),
        loggedAsError: errorSpy.mock.calls.length,
        loggedAsWarning: warnSpy.mock.calls.length,
      }).toEqual({
        answer: {
          status: 500,
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
        loggedAsError: 1,
        loggedAsWarning: 0,
      });
    },
  );

  it.each([
    ['a server that is shutting down', '57P01'],
    ['a refused connection', '08006'],
    ['a canceled statement', '57014'],
    ['a serialization failure', '40001'],
    ['a syntax error', '42601'],
  ])('answers %s as an unexpected error, as it does for MongoDB', (_, code) => {
    expect(answerTo(sqlFailure(code, 'the server said no'))).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  it('names the rule in the log and never the value that collided', () => {
    answerTo(
      sqlFailure(
        '23505',
        `duplicate key value violates unique constraint "user_email_unique" Key (email)=(${ADDRESS})`,
        'user_email_unique',
      ),
    );

    expect({
      line: logged(),
      leaked: logged().includes(ADDRESS),
    }).toEqual({
      line: 'UniqueConflictError: constraint=user_email_unique keys=unknown [request-9]',
      leaked: false,
    });
  });
});

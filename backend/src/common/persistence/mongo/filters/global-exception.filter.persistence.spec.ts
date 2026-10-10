import { ArgumentsHost, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoNetworkError, MongoServerError } from 'mongodb';
import { Error as MongooseError } from 'mongoose';
import {
  MalformedIdError,
  PersistenceTimeoutError,
  PersistenceUnavailableError,
  RetryableAbortError,
  UniqueConflictError,
  UnknownTransactionOutcomeError,
} from '../../persistence-errors';
import {
  createArgumentsHostMock,
  createRequestMock,
} from '../../../testing/test-doubles.harness-spec';
import { GlobalExceptionFilter } from '../../../filters/global-exception.filter';

const REQUEST_ID = 'request-7';
const ADDRESS = 'secret@example.com';
const BAD_ID = 'not-an-id';
const CAST_MESSAGE =
  'Cast to ObjectId failed for value "not-an-id" (type string) at path "_id" for model "User"';

interface Answer {
  status: unknown;
  code: unknown;
  message: unknown;
  requestId: unknown;
}

function duplicateKey(index: string, key: string, value: string): unknown {
  const error = new MongoServerError({
    message: `E11000 duplicate key error collection: app.things index: ${index} dup key: { ${key}: "${value}" }`,
  });
  error.code = 11000;
  error.keyPattern = { [key]: 1 };
  error.keyValue = { [key]: value };
  return error;
}

// feature:postgres:start
/** What `pg` raises, as far as the adapter and the filter read it. */
function postgresFailure(
  code: string,
  message: string,
  constraint?: string,
): Error {
  return Object.assign(new Error(message), {
    name: 'DatabaseError',
    code,
    constraint,
  });
}
// feature:postgres:end

/**
 * The answer for each of the six shared persistence errors, next to the answer
 * for the driver error it wraps, which must be the same one.
 */
describe('GlobalExceptionFilter shared persistence errors', () => {
  let filter: GlobalExceptionFilter;
  let status: jest.Mock;
  let json: jest.Mock;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GlobalExceptionFilter],
    }).compile();
    filter = module.get<GlobalExceptionFilter>(GlobalExceptionFilter);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function answerTo(exception: unknown): Answer {
    json = jest.fn().mockReturnThis();
    status = jest.fn().mockReturnValue({ json });
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
      requestId: Reflect.get(Object(body), 'requestId'),
    };
  }

  function logged(): string {
    return [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call: unknown[]) => call.map((part) => String(part)).join(' '))
      .join('\n');
  }

  const emailTaken = {
    status: 409,
    code: 'EMAIL_ALREADY_EXISTS',
    message: 'Email already registered',
    requestId: REQUEST_ID,
  };
  const conflict = {
    status: 409,
    code: 'CONFLICT',
    message: 'Resource conflict occurred',
    requestId: REQUEST_ID,
  };
  const unexpected = {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    requestId: REQUEST_ID,
  };

  describe('a refused unique rule', () => {
    it('answers a taken address like the duplicate key it wraps', () => {
      const driver = duplicateKey('email_1', 'email', ADDRESS);

      expect({
        driver: answerTo(driver),
        shared: answerTo(new UniqueConflictError('user.email', driver)),
      }).toEqual({ driver: emailTaken, shared: emailTaken });
    });

    it('lets the duplicate key decide when the rule has no shared name', () => {
      const driver = duplicateKey('email_1', 'email', ADDRESS);

      expect({
        driver: answerTo(driver),
        shared: answerTo(new UniqueConflictError('unnamed', driver)),
      }).toEqual({ driver: emailTaken, shared: emailTaken });
    });

    it('answers another taken value like the duplicate key it wraps', () => {
      const driver = duplicateKey('slug_1', 'slug', 'editor');

      expect({
        driver: answerTo(driver),
        shared: answerTo(new UniqueConflictError('role.slug', driver)),
      }).toEqual({ driver: conflict, shared: conflict });
    });

    // feature:postgres:start
    it('answers by the rule name when PostgreSQL refused the write', () => {
      const address = postgresFailure(
        '23505',
        'duplicate key value violates unique constraint "user_email_unique"',
        'user_email_unique',
      );
      const slug = postgresFailure(
        '23505',
        'duplicate key value violates unique constraint "role_slug_unique"',
        'role_slug_unique',
      );

      expect({
        address: answerTo(new UniqueConflictError('user.email', address)),
        slug: answerTo(new UniqueConflictError('role.slug', slug)),
      }).toEqual({ address: emailTaken, slug: conflict });
    });
    // feature:postgres:end

    it('answers by the rule name when the adapter gave no cause', () => {
      expect({
        address: answerTo(new UniqueConflictError('user.email')),
        slug: answerTo(new UniqueConflictError('role.slug')),
        unnamed: answerTo(new UniqueConflictError('')),
      }).toEqual({ address: emailTaken, slug: conflict, unnamed: conflict });
    });

    it('logs the rule and the key names, never the stored value', () => {
      answerTo(
        new UniqueConflictError(
          'user.email',
          duplicateKey('email_1', 'email', ADDRESS),
        ),
      );

      const line = logged();
      expect(line).toContain('constraint=user.email');
      expect(line).toContain('"email"');
      expect(line).toContain(`[${REQUEST_ID}]`);
      expect(line).not.toContain(ADDRESS);
    });
  });

  describe('a malformed id', () => {
    const cast = new MongooseError.CastError('ObjectId', BAD_ID, '_id');
    cast.message = CAST_MESSAGE;
    const invalid = {
      status: 400,
      code: 'INVALID_INPUT',
      message: 'Invalid input',
      requestId: REQUEST_ID,
    };

    it('answers like the cast failure it wraps', () => {
      const asToday = { ...invalid, message: CAST_MESSAGE };

      expect({
        driver: answerTo(cast),
        shared: answerTo(new MalformedIdError(cast)),
      }).toEqual({ driver: asToday, shared: asToday });
    });

    it('answers without the text of another database or of no cause', () => {
      // feature:postgres:start
      const refusedUuid = postgresFailure(
        '22P02',
        `invalid input syntax for type uuid: "${BAD_ID}"`,
      );

      // feature:postgres:end
      expect({
        postgres: answerTo(new MalformedIdError(refusedUuid)), // feature:postgres
        bare: answerTo(new MalformedIdError()),
      }).toEqual({
        postgres: invalid, // feature:postgres
        bare: invalid,
      });
    });

    it('logs the kind of failure, never the id that was sent', () => {
      answerTo(new MalformedIdError(cast));

      const line = logged();
      expect(line).toContain('MalformedIdError');
      expect(line).toContain(`[${REQUEST_ID}]`);
      expect(line).not.toContain(BAD_ID);
    });
  });

  describe('failures no request can repair', () => {
    it('answers an outage like the network failure it wraps', () => {
      const driver = new MongoNetworkError('connection 3 to 10.0.0.9 closed');

      expect({
        driver: answerTo(driver),
        shared: answerTo(new PersistenceUnavailableError(driver)),
      }).toEqual({ driver: unexpected, shared: unexpected });
    });

    it('answers a timeout like the expired operation it wraps', () => {
      const driver = new MongoServerError({
        message: 'operation exceeded time limit',
      });
      driver.code = 50;

      expect({
        driver: answerTo(driver),
        shared: answerTo(new PersistenceTimeoutError(driver)),
      }).toEqual({ driver: unexpected, shared: unexpected });
    });

    it('answers an abort that ran out of reruns like the write conflict it wraps', () => {
      const driver = new MongoServerError({ message: 'WriteConflict' });
      driver.code = 112;
      driver.addErrorLabel('TransientTransactionError');

      expect({
        driver: answerTo(driver),
        shared: answerTo(new RetryableAbortError(driver)),
      }).toEqual({ driver: unexpected, shared: unexpected });
    });

    it('names the database failure under an outage in the log, never its text', () => {
      answerTo(
        new PersistenceUnavailableError(
          new MongoNetworkError('connection 3 to 10.0.0.9 closed'),
        ),
      );

      const line = logged();
      expect(line).toContain('name=PersistenceUnavailableError');
      expect(line).toContain('cause=name=MongoNetworkError');
      expect(line).not.toContain('10.0.0.9');
    });
  });

  it('keeps the answer for a commit whose outcome is unknown', () => {
    const answer = answerTo(
      new UnknownTransactionOutcomeError(new Error('commit answer lost')),
    );

    expect(answer).toEqual({
      status: 503,
      code: 'TRANSACTION_OUTCOME_UNKNOWN',
      message: 'The transaction outcome is unknown',
      requestId: REQUEST_ID,
    });
  });
});

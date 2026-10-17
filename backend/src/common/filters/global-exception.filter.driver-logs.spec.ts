import { Test, TestingModule } from '@nestjs/testing';
import { Logger, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { GlobalExceptionFilter } from './global-exception.filter';
import {
  createArgumentsHostMock,
  createRequestMock,
} from '../testing/test-doubles.harness-spec';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../enums/error-code.enum';

/**
 * The lines the filter writes for driver failures: name, code and key
 * pattern or path, never the offending value the driver embedded in the
 * message or in the first line of the stack.
 */
describe('GlobalExceptionFilter driver error log lines', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: Partial<Response>;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GlobalExceptionFilter],
    }).compile();
    filter = module.get<GlobalExceptionFilter>(GlobalExceptionFilter);

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockHost(): ArgumentsHost {
    return createArgumentsHostMock({
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => createRequestMock({}),
      }),
    });
  }

  function logged(): string {
    return [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call: unknown[]) => call.map((v) => String(v)).join(' '))
      .join('\n');
  }

  it('logs a duplicate key by key names, never the address', () => {
    const exception = {
      name: 'MongoServerError',
      code: 11000,
      keyPattern: { email: 1 },
      keyValue: { email: 'secret@example.com' },
      message:
        'E11000 duplicate key error collection: users index: email dup key: { email: "secret@example.com" }',
    };

    filter.catch(exception, mockHost());

    const line = logged();
    expect(line).toContain('MongoDuplicateKeyError');
    expect(line).toContain('code=11000');
    expect(line).toContain('"email"');
    expect(line).not.toContain('secret@example.com');
    expect(line).not.toContain('dup key');
  });

  it('logs a CastError by path and value type, never the value', () => {
    const exception = {
      name: 'CastError',
      path: '_id',
      value: "not-an-id'",
      message:
        'Cast to ObjectId failed for value "not-an-id\'" (type string) at path "_id"',
    };

    filter.catch(exception, mockHost());

    const line = logged();
    expect(line).toContain('CastError');
    expect(line).toContain('path=_id');
    expect(line).toContain('value=string');
    expect(line).not.toContain("not-an-id'");
  });

  it('logs an unknown driver failure by name, code and paths, never its message', () => {
    const exception = Object.assign(
      new Error(
        'Validation failed: email: Cast to String failed for value "LEAKED"',
      ),
      {
        name: 'ValidationError',
        errors: {
          email: { message: 'Cast to String failed for value "LEAKED"' },
        },
      },
    );

    filter.catch(exception, mockHost());

    const line = logged();
    expect(line).toContain('name=ValidationError');
    expect(line).toContain('paths=email');
    // The first line of the stack repeats the message, so it is dropped.
    for (const call of errorSpy.mock.calls) {
      for (const part of call) {
        expect(String(part)).not.toContain('LEAKED');
      }
    }
  });

  it('logs an AppException by status and code without its input-bearing message', () => {
    filter.catch(
      new AppException(
        ErrorCode.NOT_FOUND,
        'Role secret@example.com hunter2 not found',
        404,
      ),
      mockHost(),
    );
    expect(logged()).toContain('AppException (404): NOT_FOUND');
    expect(logged()).not.toContain('secret@example.com');
    expect(logged()).not.toContain('hunter2');
  });

  it('keeps later lines of a multi-line message out of the stack frames', () => {
    const exception = new Error(
      'query failed\nfilter: { email: "a@b.c" }\nmore',
    );

    filter.catch(exception, mockHost());

    for (const call of errorSpy.mock.calls) {
      for (const part of call) {
        expect(String(part)).not.toContain('a@b.c');
        expect(String(part)).not.toContain('query failed');
      }
    }
  });

  it('removes message lines disguised as stack frames while retaining real frames', () => {
    filter.catch(
      new Error(
        'query failed\n    at secret@example.com hunter2\n    at forged (hunter2:1:1)',
      ),
      mockHost(),
    );
    const line = logged();
    expect(line).not.toContain('secret@example.com');
    expect(line).not.toContain('hunter2');
    expect(line).not.toContain('forged');
    expect(line).toContain('at ');
  });

  it.each([
    {
      name: 'CastError',
      path: 'secret@example.com hunter2',
      value: 'x',
      expected: 'path=unprintable value=string',
    },
    {
      name: 'MongoServerError',
      code: 11000,
      keyPattern: { 'secret@example.com hunter2': 1 },
      expected: 'keys=["unprintable"]',
    },
    {
      name: 'MongoServerError',
      code: 11000,
      keyValue: { 'secret@example.com hunter2': 'x' },
      expected: 'keys=["unprintable"]',
    },
    {
      name: 'ValidationError',
      errors: { 'secret@example.com hunter2': {} },
      expected: 'paths=unprintable',
    },
  ])(
    'sanitizes driver field names: $expected',
    ({ expected, ...exception }) => {
      filter.catch(exception, mockHost());
      expect(logged()).toContain(expected);
      expect(logged()).not.toContain('secret@example.com');
      expect(logged()).not.toContain('hunter2');
    },
  );

  it('replaces a hostile name or a non-number code with a placeholder', () => {
    const hostile = new Error('x');
    hostile.name = 'Oops a@b.c';
    filter.catch(hostile, mockHost());
    expect(logged()).toContain('name=unprintable');

    warnSpy.mockClear();
    errorSpy.mockClear();
    const coded = Object.assign(new Error('x'), {
      name: 'MongoServerError',
      code: { email: 'a@b.c' },
    });
    filter.catch(coded, mockHost());
    expect(logged()).toContain('code=unprintable');
    expect(logged()).not.toContain('a@b.c');

    warnSpy.mockClear();
    errorSpy.mockClear();
    filter.catch('a@b.c went wrong', mockHost());
    expect(logged()).toContain('non-object string');
    expect(logged()).not.toContain('a@b.c');
  });

  it('names a cause one level deep, never its message', () => {
    const exception = new Error('outer', {
      cause: new Error('inner a@b.c'),
    });

    filter.catch(exception, mockHost());

    const line = logged();
    expect(line).toContain('cause=name=Error');
    for (const call of errorSpy.mock.calls) {
      for (const part of call) {
        expect(String(part)).not.toContain('inner a@b.c');
      }
    }
  });

  it.each([
    {
      name: 'Driver.Error_1',
      code: 'ERR_1',
      expected: 'name=Driver.Error_1 code=ERR_1',
    },
    { name: 'DriverError', code: 42, expected: 'name=DriverError code=42' },
    {
      name: 42,
      code: 'secret@example.com',
      expected: 'name=unprintable code=unprintable',
    },
    {
      name: 'secret@example.com',
      code: { secret: 'hunter2' },
      expected: 'name=unprintable code=unprintable',
    },
    {
      name: 'a'.repeat(61),
      code: 'b'.repeat(61),
      expected: 'name=unprintable code=unprintable',
    },
  ])(
    'sanitizes outer and cause tokens $expected',
    ({ name, code, expected }) => {
      const exception = {
        name,
        code,
        message: 'hunter2',
        cause: {
          name,
          code,
          message: 'secret@example.com',
          cause: { name: 'DeeperSecret' },
        },
      };
      filter.catch(exception, mockHost());
      expect(logged()).toContain(
        `Unknown exception: ${expected} cause=${expected}`,
      );
      expect(logged()).not.toContain('hunter2');
      expect(logged()).not.toContain('secret@example.com');
      expect(logged()).not.toContain('DeeperSecret');
    },
  );
});

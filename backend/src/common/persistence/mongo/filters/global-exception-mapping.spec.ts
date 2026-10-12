import { Test, TestingModule } from '@nestjs/testing';
import { GlobalExceptionFilter } from '../../../filters/global-exception.filter';
import { ErrorCode } from '../../../enums/error-code.enum';
import { UnknownTransactionOutcomeError } from '../../../exceptions/unknown-transaction-outcome.error';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ArgumentsHost } from '@nestjs/common';
import { RequestWithId } from '../../../interfaces/request-with-id.interface';
import { Error as MongooseError } from 'mongoose';
import { MongoServerError } from 'mongodb';
import {
  createArgumentsHostMock,
  createRequestMock,
} from '../../../testing/test-doubles.harness-spec';

describe('GlobalExceptionFilter Mapping', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: Partial<Response>;
  let mockRequest: RequestWithId;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GlobalExceptionFilter],
    }).compile();

    filter = module.get<GlobalExceptionFilter>(GlobalExceptionFilter);

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = createRequestMock({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function createMockHost(): ArgumentsHost {
    return createArgumentsHostMock({
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    });
  }

  it('maps an unhandled unknown commit to the retryable outcome code', () => {
    filter.catch(
      new UnknownTransactionOutcomeError(new Error('commit answer lost')),
      createMockHost(),
    );

    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
        }),
      }),
    );
  });

  describe('Mongoose CastError handling (D-07)', () => {
    it('maps CastError to 400 with INVALID_INPUT', () => {
      const castError = new MongooseError.CastError(
        'ObjectId',
        'invalid-id',
        'userId',
      );

      filter.catch(castError, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: ErrorCode.INVALID_INPUT,
          }),
        }),
      );
    });

    it('maps plain object with name CastError to 400 with INVALID_INPUT', () => {
      const mockCastError = {
        name: 'CastError',
        message: 'Cast to ObjectId failed for value "123"',
      };

      filter.catch(mockCastError, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.INVALID_INPUT,
            message: 'Cast to ObjectId failed for value "123"',
          }),
        }),
      );
    });
  });

  describe('MongoServerError 11000 duplicate key handling (D-07)', () => {
    it('maps duplicate email by keyPattern to 409 EMAIL_ALREADY_EXISTS', () => {
      const mongoError = new MongoServerError({
        message: 'E11000 duplicate key error collection: users index: email_1',
      });
      mongoError.code = 11000;
      mongoError.keyPattern = { email: 1 };
      mongoError.keyValue = { email: 'duplicate@example.com' };

      filter.catch(mongoError, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: ErrorCode.EMAIL_ALREADY_EXISTS,
            message: 'Email already registered',
          }),
        }),
      );
    });

    it('maps duplicate email by message to 409 EMAIL_ALREADY_EXISTS', () => {
      const mockError = {
        name: 'MongoServerError',
        code: 11000,
        message:
          'E11000 duplicate key error collection: users dup key: { email: "test@example.com" }',
      };

      filter.catch(mockError, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.EMAIL_ALREADY_EXISTS,
          }),
        }),
      );
    });

    it('maps non-email duplicate key to 409 CONFLICT', () => {
      const mongoError = new MongoServerError({
        message: 'E11000 duplicate key error collection: roles index: slug_1',
      });
      mongoError.code = 11000;
      mongoError.keyPattern = { slug: 1 };
      mongoError.keyValue = { slug: 'admin' };

      filter.catch(mongoError, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: ErrorCode.CONFLICT,
          }),
        }),
      );
    });
  });

  describe('HttpException status fallback mapping (X-29)', () => {
    it('maps 400 status to INVALID_INPUT', () => {
      const exception = new HttpException(
        'Bad request',
        HttpStatus.BAD_REQUEST,
      );
      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: ErrorCode.INVALID_INPUT }),
        }),
      );
    });

    it('maps 401 status to SESSION_INVALID', () => {
      const exception = new HttpException(
        'Unauthorized',
        HttpStatus.UNAUTHORIZED,
      );
      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: ErrorCode.SESSION_INVALID }),
        }),
      );
    });

    it('maps 403 status to FORBIDDEN', () => {
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: ErrorCode.FORBIDDEN }),
        }),
      );
    });

    it('maps 404 status to NOT_FOUND', () => {
      const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);
      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: ErrorCode.NOT_FOUND }),
        }),
      );
    });

    it('maps 409 status to CONFLICT', () => {
      const exception = new HttpException('Conflict', HttpStatus.CONFLICT);
      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: ErrorCode.CONFLICT }),
        }),
      );
    });

    it('maps unknown status to INTERNAL_ERROR', () => {
      const exception = new HttpException('Teapot', HttpStatus.I_AM_A_TEAPOT);
      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.I_AM_A_TEAPOT,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: ErrorCode.INTERNAL_ERROR }),
        }),
      );
    });
  });
});

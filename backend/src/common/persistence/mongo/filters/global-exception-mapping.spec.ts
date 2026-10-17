import { Test, TestingModule } from '@nestjs/testing';
import { GlobalExceptionFilter } from '../../../filters/global-exception.filter';
import { ErrorCode } from '../../../enums/error-code.enum';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ArgumentsHost } from '@nestjs/common';
import { RequestWithId } from '../../../interfaces/request-with-id.interface';
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

  describe('Mongoose CastError handling (D-07)', () => {
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
  });

  describe('HttpException status fallback mapping (X-29)', () => {
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
  });
});

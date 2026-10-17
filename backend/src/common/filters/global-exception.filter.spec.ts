import { Test, TestingModule } from '@nestjs/testing';
import { GlobalExceptionFilter } from './global-exception.filter';
import { ErrorCode } from '../enums/error-code.enum';
import { HttpStatus, Logger } from '@nestjs/common';
import { IsEmail, MinLength } from 'class-validator';
import { createValidationPipe } from '../pipes/validation-pipe.factory';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';
import { ArgumentsHost } from '@nestjs/common';
import { RequestWithId } from '../interfaces/request-with-id.interface';
import {
  createArgumentsHostMock,
  createRequestMock,
} from '../testing/test-doubles.harness-spec';

describe('GlobalExceptionFilter', () => {
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

  describe('Validation exception handling', () => {
    class ProfileDto {
      @MinLength(2, { message: 'Name must be at least 2 characters' })
      name!: string;

      @IsEmail()
      email!: string;
    }

    describe('log line', () => {
      let warn: jest.SpyInstance;

      beforeEach(() => {
        warn = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
      });

      afterEach(() => {
        warn.mockRestore();
      });

      it('names the failed DTO fields with the request id and nothing the caller sent', async () => {
        mockRequest.requestId = 'req-1';
        const rejection: unknown = await createValidationPipe()
          .transform(
            { name: 'Q', email: 'zz-submitted-value', zzUnknownKey: 'zz' },
            { type: 'body', metatype: ProfileDto },
          )
          .catch((error: unknown) => error);

        filter.catch(rejection, createMockHost());

        expect(warn.mock.calls).toEqual([
          [
            'AppException (400): VALIDATION_ERROR (fields: name, email; omitted: 1) [req-1]',
          ],
        ]);
        const line = String(warn.mock.calls[0]?.[0]);
        expect(line).not.toContain('zz');
        expect(line).not.toContain('must be');
      });
    });
  });

  describe('ThrottlerException handling', () => {
    it('handles ThrottlerException with RATE_LIMIT_EXCEEDED and retryAfter', () => {
      const exception = new ThrottlerException('60');

      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            details: expect.objectContaining({
              retryAfter: 60,
            }),
          }),
        }),
      );
    });
  });

  describe('Unknown exception handling', () => {
    it('maps unhandled Error instances to 500 INTERNAL_ERROR', () => {
      const exception = new Error('Database connection lost');

      filter.catch(exception, createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.INTERNAL_ERROR,
            message: 'An unexpected error occurred',
          }),
        }),
      );
    });

    it('maps non-Error exceptions to 500 INTERNAL_ERROR', () => {
      filter.catch('String exception', createMockHost());

      expect(mockResponse.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCode.INTERNAL_ERROR,
            message: 'An unexpected error occurred',
          }),
        }),
      );
    });
  });
});

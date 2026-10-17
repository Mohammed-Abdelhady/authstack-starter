import { CallHandler, Logger } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { createExecutionContextMock } from '../testing/test-doubles.harness-spec';

describe('RequestLoggingInterceptor (X-19)', () => {
  let interceptor: RequestLoggingInterceptor;
  let logSpy: jest.SpyInstance;

  const createContext = (
    statusCode: number,
    originalUrl = '/api/user/profile',
  ) =>
    createExecutionContextMock({
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          originalUrl,
          requestId: 'req-1',
        }),
        getResponse: () => ({ statusCode }),
      }),
    });

  const handlerOf = (result: unknown): CallHandler => ({
    handle: () => of(result),
  });

  beforeEach(() => {
    interceptor = new RequestLoggingInterceptor();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should drop the query string, which carries the OAuth code', async () => {
    await lastValueFrom(
      interceptor.intercept(
        createContext(302, '/api/auth/oauth/google/callback?code=secret'),
        handlerOf(undefined),
      ),
    );

    const [message] = logSpy.mock.calls[0] as [string];
    expect(message).toContain('/api/auth/oauth/google/callback');
    expect(message).not.toContain('code=');
  });
});

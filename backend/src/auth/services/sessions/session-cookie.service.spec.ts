import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SessionCookieService } from './session-cookie.service';
import {
  createRequestMock,
  createResponseMock,
} from '../../../common/testing/test-doubles.harness-spec';

describe('SessionCookieService (X-13, D-29)', () => {
  let service: SessionCookieService;
  let configService: {
    get: jest.Mock;
  };

  const createService = async (
    configMap: Record<string, unknown>,
  ): Promise<SessionCookieService> => {
    configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        return configMap[key] !== undefined ? configMap[key] : defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionCookieService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    return module.get<SessionCookieService>(SessionCookieService);
  };

  describe('name', () => {
    it('should default to sid in development', async () => {
      service = await createService({
        NODE_ENV: 'development',
      });
      expect(service.name).toBe('sid');
    });

    it('should default to __Host-sid in production', async () => {
      service = await createService({
        NODE_ENV: 'production',
      });
      expect(service.name).toBe('__Host-sid');
    });

    it('should honor custom session.cookieName if configured', async () => {
      service = await createService({
        'session.cookieName': 'custom-session-id',
        NODE_ENV: 'production',
      });
      expect(service.name).toBe('custom-session-id');
    });
  });

  describe('options', () => {
    it('should return secure false in development', async () => {
      service = await createService({
        NODE_ENV: 'development',
        'session.cookieMaxAge': 604800000,
      });

      expect(service.options).toEqual({
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: '/',
        maxAge: 604800000,
      });
    });

    it('should return secure true in production', async () => {
      service = await createService({
        NODE_ENV: 'production',
        'session.cookieMaxAge': 604800000,
      });

      expect(service.options).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 604800000,
      });
    });
  });

  describe('by environment and client address', () => {
    it.each([
      ['development', 'http://localhost:3000', 'sid', false],
      ['development', 'https://app.example.com', '__Host-sid', true],
      ['production', 'https://app.example.com', '__Host-sid', true],
      ['production', 'http://app.example.com', '__Host-sid', true],
    ])(
      'NODE_ENV %s with CLIENT_URL %s',
      async (nodeEnv, clientUrl, name, secure) => {
        service = await createService({
          NODE_ENV: nodeEnv,
          CLIENT_URL: clientUrl,
        });
        const cookieMock = jest.fn();
        const clearCookieMock = jest.fn();
        const response = createResponseMock({
          cookie: cookieMock,
          clearCookie: clearCookieMock,
        });

        service.set(response, 'token-abc');
        service.clear(response);

        expect(cookieMock).toHaveBeenCalledWith(
          name,
          'token-abc',
          expect.objectContaining({ secure, httpOnly: true, path: '/' }),
        );
        expect(clearCookieMock).toHaveBeenCalledWith(
          name,
          expect.objectContaining({ secure, httpOnly: true, path: '/' }),
        );
      },
    );
  });

  describe('set', () => {
    it('should set cookie on response with configured options', async () => {
      service = await createService({
        NODE_ENV: 'development',
        'session.cookieMaxAge': 3600000,
      });

      const cookieMock = jest.fn();
      const mockResponse = createResponseMock({ cookie: cookieMock });

      service.set(mockResponse, 'token-abc');

      expect(cookieMock).toHaveBeenCalledWith(
        'sid',
        'token-abc',
        expect.objectContaining({
          httpOnly: true,
          secure: false,
          sameSite: 'strict',
          path: '/',
          maxAge: 3600000,
        }),
      );
    });
  });

  describe('clear', () => {
    it('should clear cookie with strict options', async () => {
      service = await createService({
        NODE_ENV: 'production',
      });

      const clearCookieMock = jest.fn();
      const mockResponse = createResponseMock({ clearCookie: clearCookieMock });

      service.clear(mockResponse);

      expect(clearCookieMock).toHaveBeenCalledWith(
        '__Host-sid',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/',
        }),
      );
    });
  });

  describe('read', () => {
    it('should read cookie from request', async () => {
      service = await createService({
        NODE_ENV: 'development',
      });

      const mockRequest = createRequestMock({
        cookies: {
          sid: 'raw-token-123',
        },
      });

      expect(service.read(mockRequest)).toBe('raw-token-123');
    });

    it('should return undefined if cookie is missing', async () => {
      service = await createService({
        NODE_ENV: 'development',
      });

      const mockRequest = createRequestMock({ cookies: {} });

      expect(service.read(mockRequest)).toBeUndefined();
    });

    it('should return undefined if cookies object is missing', async () => {
      service = await createService({
        NODE_ENV: 'development',
      });

      const mockRequest = createRequestMock({});

      expect(service.read(mockRequest)).toBeUndefined();
    });
  });
});

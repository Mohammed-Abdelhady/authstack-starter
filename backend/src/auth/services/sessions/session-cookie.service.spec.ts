import { BROWSER_APPLICATIONS_TEST_PROVIDER } from '../../../common/testing/browser-applications.harness-spec';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SessionCookieService } from './session-cookie.service';
import { createResponseMock } from '../../../common/testing/test-doubles.harness-spec';

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
        BROWSER_APPLICATIONS_TEST_PROVIDER,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    return module.get<SessionCookieService>(SessionCookieService);
  };

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
});

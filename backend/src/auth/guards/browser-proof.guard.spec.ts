import { browserApplicationsForTest } from '../../common/testing/browser-applications.harness-spec';
import { SESSION_COOKIE_DEFAULT_NAME } from '../../config/utils/production-environment.util';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { CSRF_HEADER } from '../../session/constants/browser-proof';
import { CREDENTIAL_PURPOSE } from '../../session/constants/credential-purpose';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../session/constants/client-ids';
import { ApplicationRegistry } from '../../session/applications/application-registry';
import { BrowserProofService } from '../../session/services/browser-proof.service';
import { Sessions } from '../services/sessions/sessions';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { BrowserProofGuard } from './browser-proof.guard';

const ORIGIN = 'http://localhost:3000';
const ADMIN_ORIGIN = 'http://admin.example.test';
const PRE_SESSION_TOKEN = 'pre-session-token';
const SESSION_TOKEN = 'session-bound-token';

interface GuardRequest {
  method: string;
  cookies: Record<string, string>;
  headers: Record<string, string>;
  session?: {
    clientId: string;
    csrfToken: string;
    credentialPurpose?: string;
  };
  header: (name: string) => string | undefined;
}

describe('BrowserProofGuard', () => {
  let guard: BrowserProofGuard;
  let sessionCookie: SessionCookieService;
  let sessions: { validateSessionWithoutExtendingIdle: jest.Mock };
  let proofs: { consume: jest.Mock };
  let applications: { findByClientId: jest.Mock };

  beforeEach(async () => {
    const config = new ConfigService({
      session: { cookieName: SESSION_COOKIE_DEFAULT_NAME },
      cors: { clientUrl: ORIGIN, adminUrl: ADMIN_ORIGIN },
    });
    const browserApplications = browserApplicationsForTest(config);
    sessionCookie = new SessionCookieService(config, browserApplications);
    sessions = { validateSessionWithoutExtendingIdle: jest.fn() };
    proofs = { consume: jest.fn().mockResolvedValue(undefined) };
    applications = {
      findByClientId: jest.fn((clientId: string) =>
        Promise.resolve({
          allowedOrigins: [
            clientId === ADMIN_CLIENT_ID ? ADMIN_ORIGIN : ORIGIN,
          ],
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrowserProofGuard,
        Reflector,
        { provide: SessionCookieService, useValue: sessionCookie },
        { provide: Sessions, useValue: sessions },
        { provide: BrowserProofService, useValue: proofs },
        { provide: ApplicationRegistry, useValue: applications },
      ],
    }).compile();

    guard = module.get(BrowserProofGuard);
  });

  it('consumes a pre-session proof when a public route has a stale cookie', async () => {
    const request = createRequest({ sid: 'revoked' }, PRE_SESSION_TOKEN);
    sessions.validateSessionWithoutExtendingIdle.mockResolvedValue(null);

    await expect(guard.canActivate(createContext(request, true))).resolves.toBe(
      true,
    );

    expect(proofs.consume).toHaveBeenCalledWith(request, PRE_SESSION_TOKEN);
    expect(sessions.validateSessionWithoutExtendingIdle).toHaveBeenCalledWith(
      'revoked',
    );
  });

  it('checks the session-bound token on protected routes', async () => {
    const request = createRequest({ sid: 'valid' }, PRE_SESSION_TOKEN, {
      clientId: WEB_CLIENT_ID,
      csrfToken: SESSION_TOKEN,
    });

    await expect(
      guard.canActivate(createContext(request)),
    ).rejects.toMatchObject({ code: ErrorCode.CSRF_INVALID });

    expect(proofs.consume).not.toHaveBeenCalled();
  });

  it('accepts the session token on a public route with a valid cookie', async () => {
    const session = { clientId: ADMIN_CLIENT_ID, csrfToken: SESSION_TOKEN };
    const request = createRequest(
      { [`${SESSION_COOKIE_DEFAULT_NAME}-${ADMIN_CLIENT_ID}`]: 'valid' },
      SESSION_TOKEN,
    );
    request.headers.origin = ADMIN_ORIGIN;
    sessions.validateSessionWithoutExtendingIdle.mockResolvedValue(session);

    await expect(guard.canActivate(createContext(request, true))).resolves.toBe(
      true,
    );

    expect(proofs.consume).not.toHaveBeenCalled();
    expect(applications.findByClientId).toHaveBeenCalledWith(ADMIN_CLIENT_ID);
  });

  it('consumes a pre-session proof on a public route with a valid cookie', async () => {
    sessions.validateSessionWithoutExtendingIdle.mockResolvedValue({
      clientId: WEB_CLIENT_ID,
      csrfToken: SESSION_TOKEN,
    });
    const request = createRequest({ sid: 'valid' }, PRE_SESSION_TOKEN);

    await expect(guard.canActivate(createContext(request, true))).resolves.toBe(
      true,
    );

    expect(proofs.consume).toHaveBeenCalledWith(request, PRE_SESSION_TOKEN);
  });

  it('consumes a pre-session proof on a public route without a cookie', async () => {
    const request = createRequest({}, PRE_SESSION_TOKEN);

    await expect(guard.canActivate(createContext(request, true))).resolves.toBe(
      true,
    );

    expect(sessions.validateSessionWithoutExtendingIdle).not.toHaveBeenCalled();
    expect(proofs.consume).toHaveBeenCalledWith(request, PRE_SESSION_TOKEN);
  });

  it('lets a bearer credential win over a session cookie', async () => {
    const request = createRequest(
      { sid: 'valid' },
      PRE_SESSION_TOKEN,
      {
        clientId: 'native-app',
        csrfToken: SESSION_TOKEN,
        credentialPurpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
      },
      'Bearer access-token',
    );

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(proofs.consume).not.toHaveBeenCalled();
  });

  it('still reports mixed credentials for a non-bearer authorization with a cookie', async () => {
    const request = createRequest(
      { sid: 'valid' },
      PRE_SESSION_TOKEN,
      undefined,
      'Basic dXNlcjpwYXNzd29yZA==',
    );

    await expect(
      guard.canActivate(createContext(request)),
    ).rejects.toMatchObject({ code: ErrorCode.MIXED_CREDENTIALS });
  });

  it('refuses a public route that would act on the cookie when a bearer is also sent', async () => {
    const request = createRequest(
      { sid: 'valid' },
      PRE_SESSION_TOKEN,
      undefined,
      'Bearer access-token',
    );

    await expect(
      guard.canActivate(createContext(request, true)),
    ).rejects.toMatchObject({ code: ErrorCode.MIXED_CREDENTIALS });
    expect(proofs.consume).not.toHaveBeenCalled();
  });
});

function createRequest(
  cookies: Record<string, string>,
  csrfToken: string,
  session?: GuardRequest['session'],
  authorization?: string,
): GuardRequest {
  const headers: Record<string, string> = {
    [CSRF_HEADER]: csrfToken,
    origin: ORIGIN,
  };
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  return {
    method: 'POST',
    cookies,
    headers,
    session,
    header: (name) => headers[name.toLowerCase()],
  };
}

function createContext(
  request: GuardRequest,
  isPublic = false,
): ExecutionContextHost {
  const handler = (): void => undefined;
  if (isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
  return new ExecutionContextHost([request, {}], BrowserProofGuard, handler);
}

import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { hkdfSync } from 'node:crypto';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { browserApplicationsForTest } from '../../../common/testing/browser-applications.harness-spec';
import {
  createRequestMock,
  createResponseMock,
  partialMock,
} from '../../../common/testing/test-doubles.harness-spec';
import { BrowserApplications } from '../../../session/applications/browser-applications';
import { PASSKEY_CHALLENGE_COOKIE } from '../constants/passkeys.constants';
import { PasskeyChallengeStore } from '../stores/passkey-challenge.store';
import { encodeSignedCookie } from '../utils/signed-cookie.util';
import { PasskeyChallengeService } from './passkey-challenge.service';

const CHALLENGE_INVALID = {
  code: ErrorCode.PASSKEY_CHALLENGE_INVALID,
  status: 401,
};

/** Written out, so a renamed cookie cannot agree with itself. */
const ADMIN_CHALLENGE_COOKIE = 'pk_challenge-admin';
const WEB_ORIGIN = 'http://localhost:3000';
const ADMIN_ORIGIN = 'http://localhost:3001';
const STATE_SECRET = 'z'.repeat(32);

/** The key the OAuth state secret signs challenges under, derived here apart from the service. */
function stateSecretKey(): Buffer {
  return Buffer.from(
    hkdfSync('sha256', STATE_SECRET, Buffer.alloc(0), 'passkey-challenge', 32),
  );
}

/** A deployment with an admin application beside the web one. */
function configWithAdmin(): ConfigService {
  return new ConfigService({
    'oauth.stateSecret': STATE_SECRET,
    'cors.adminUrl': ADMIN_ORIGIN,
    NODE_ENV: 'test',
  });
}

/**
 * The service on any database: these cases never spend a stored challenge,
 * and what the store does with one is the passkey contract's to prove.
 */
function challengeService(
  config: ConfigService = configWithAdmin(),
  applications: BrowserApplications = browserApplicationsForTest(config),
): PasskeyChallengeService {
  return new PasskeyChallengeService(
    partialMock<PasskeyChallengeStore>({ open: () => Promise.resolve() }),
    config,
    applications,
  );
}

/** A response to a page at `origin`, keeping the cookies the service sets. */
function responseTo(origin: string): {
  response: Response;
  cookies: Record<string, string>;
} {
  const cookies: Record<string, string> = {};
  const response = createResponseMock({
    cookie: (name: string, value: string): void => {
      cookies[name] = value;
    },
    req: createRequestMock({ headers: { origin } }),
  });
  return { response, cookies };
}

/** A request carrying `cookies`, from a page at `origin` or from no page. */
function requestWith(
  cookies: Record<string, string>,
  origin?: string,
): Request {
  return createRequestMock({ cookies, headers: origin ? { origin } : {} });
}

describe('PasskeyChallengeService and the application a challenge was issued for', () => {
  // Failure: a challenge one browser application handed out completes a
  // ceremony, and with it a sign-in, in the other.
  it('is spent only from its own application, each in its own cookie', async () => {
    const service = challengeService();
    const web = responseTo(WEB_ORIGIN);
    const admin = responseTo(ADMIN_ORIGIN);
    await service.issue(web.response, 'login', 'web-challenge');
    await service.issue(admin.response, 'login', 'admin-challenge');
    expect(Object.keys(web.cookies)).toEqual([PASSKEY_CHALLENGE_COOKIE]);
    expect(Object.keys(admin.cookies)).toEqual([ADMIN_CHALLENGE_COOKIE]);
    const webValue = web.cookies[PASSKEY_CHALLENGE_COOKIE];
    const adminValue = admin.cookies[ADMIN_CHALLENGE_COOKIE];

    await expect(
      service.read(
        requestWith({ [ADMIN_CHALLENGE_COOKIE]: webValue }, ADMIN_ORIGIN),
        'login',
      ),
    ).rejects.toMatchObject(CHALLENGE_INVALID);
    await expect(
      service.read(
        requestWith({ [PASSKEY_CHALLENGE_COOKIE]: adminValue }, WEB_ORIGIN),
        'login',
      ),
    ).rejects.toMatchObject(CHALLENGE_INVALID);
    expect(
      (
        await service.read(
          requestWith({ [ADMIN_CHALLENGE_COOKIE]: adminValue }, ADMIN_ORIGIN),
          'login',
        )
      ).challenge,
    ).toBe('admin-challenge');
  });

  // Failure: a challenge issued before challenges named their application
  // stops working, or opens the admin application.
  it('counts a legacy challenge with no application as the web one', async () => {
    const service = challengeService();
    const legacy = encodeSignedCookie(
      {
        purpose: 'login',
        challenge: 'legacy-web-challenge',
        expiresAt: Date.now() + 60_000,
      },
      stateSecretKey(),
    );

    expect(
      (
        await service.read(
          requestWith({ [PASSKEY_CHALLENGE_COOKIE]: legacy }),
          'login',
        )
      ).challenge,
    ).toBe('legacy-web-challenge');
    await expect(
      service.read(
        requestWith({ [ADMIN_CHALLENGE_COOKIE]: legacy }, ADMIN_ORIGIN),
        'login',
      ),
    ).rejects.toMatchObject(CHALLENGE_INVALID);
  });

  // Failure: a verify request is answered for the application its origin
  // names instead of the one its own signed challenge names.
  it('names the application of a verify route from the signed challenge alone', async () => {
    const config = configWithAdmin();
    const applications = browserApplicationsForTest(config);
    const service = challengeService(config, applications);
    service.onModuleInit();
    const admin = responseTo(ADMIN_ORIGIN);
    await service.issue(admin.response, 'register', 'admin-challenge');
    const adminValue = admin.cookies[ADMIN_CHALLENGE_COOKIE];
    const verify = (cookies: Record<string, string>, path: string) =>
      createRequestMock({
        method: 'POST',
        path,
        cookies,
        headers: { origin: WEB_ORIGIN },
      });

    const bound = verify(
      { [ADMIN_CHALLENGE_COOKIE]: adminValue },
      '/api/auth/passkeys/register/verify',
    );
    const misplaced = verify(
      { [PASSKEY_CHALLENGE_COOKIE]: adminValue },
      '/api/auth/passkeys/register/verify',
    );
    const otherRoute = verify(
      { [ADMIN_CHALLENGE_COOKIE]: adminValue },
      '/api/auth/passkeys/login/verify',
    );

    expect((await applications.resolve(bound)).clientId).toBe('admin');
    expect((await applications.resolve(misplaced)).clientId).toBe('web');
    expect((await applications.resolve(otherRoute)).clientId).toBe('web');
    await expect(service.read(misplaced, 'register')).rejects.toMatchObject(
      CHALLENGE_INVALID,
    );
  });
});

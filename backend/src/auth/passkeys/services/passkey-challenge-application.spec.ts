import { ErrorCode } from '../../../common/enums/error-code.enum';
import { browserApplicationsForTest } from '../../../common/testing/browser-applications.harness-spec';
import { createRequestMock } from '../../../common/testing/test-doubles.harness-spec';
import { PASSKEY_CHALLENGE_COOKIE } from '../constants/passkeys.constants';
import { encodeSignedCookie } from '../utils/signed-cookie.util';
import { hkdfSync } from 'node:crypto';
import {
  createChallengeService,
  createChallengeStore,
  createConfigService,
  createMockRequest,
  createMockResponse,
  PASSKEY_CONFIG,
  STATE_SECRET,
} from '../persistence/mongo/passkeys.harness-spec';

const CHALLENGE_INVALID = {
  code: ErrorCode.PASSKEY_CHALLENGE_INVALID,
  status: 401,
};

/** Written out, so a renamed cookie cannot agree with itself. */
const ADMIN_CHALLENGE_COOKIE = 'pk_challenge-admin';
const WEB_ORIGIN = 'http://localhost:3000';
const ADMIN_ORIGIN = 'http://localhost:3001';
const WITH_ADMIN = { ...PASSKEY_CONFIG, 'cors.adminUrl': ADMIN_ORIGIN };

/** The key the OAuth state secret signs challenges under, derived here apart from the service. */
function stateSecretKey(): Buffer {
  return Buffer.from(
    hkdfSync('sha256', STATE_SECRET, Buffer.alloc(0), 'passkey-challenge', 32),
  );
}

describe('PasskeyChallengeService and the application a challenge was issued for', () => {
  // Failure: a challenge one browser application handed out completes a
  // ceremony, and with it a sign-in, in the other.
  it('is spent only from its own application, each in its own cookie', async () => {
    const service = createChallengeService(WITH_ADMIN);
    const web = createMockResponse(WEB_ORIGIN);
    const admin = createMockResponse(ADMIN_ORIGIN);
    await service.issue(web.response, 'login', 'web-challenge');
    await service.issue(admin.response, 'login', 'admin-challenge');
    expect(Object.keys(web.cookies)).toEqual([PASSKEY_CHALLENGE_COOKIE]);
    expect(Object.keys(admin.cookies)).toEqual([ADMIN_CHALLENGE_COOKIE]);
    const webValue = web.cookies[PASSKEY_CHALLENGE_COOKIE];
    const adminValue = admin.cookies[ADMIN_CHALLENGE_COOKIE];

    await expect(
      service.read(
        createMockRequest({ [ADMIN_CHALLENGE_COOKIE]: webValue }, ADMIN_ORIGIN),
        'login',
      ),
    ).rejects.toMatchObject(CHALLENGE_INVALID);
    await expect(
      service.read(
        createMockRequest(
          { [PASSKEY_CHALLENGE_COOKIE]: adminValue },
          WEB_ORIGIN,
        ),
        'login',
      ),
    ).rejects.toMatchObject(CHALLENGE_INVALID);
    expect(
      (
        await service.read(
          createMockRequest(
            { [ADMIN_CHALLENGE_COOKIE]: adminValue },
            ADMIN_ORIGIN,
          ),
          'login',
        )
      ).challenge,
    ).toBe('admin-challenge');
  });

  // Failure: a challenge issued before challenges named their application
  // stops working, or opens the admin application.
  it('counts a legacy challenge with no application as the web one', async () => {
    const service = createChallengeService(WITH_ADMIN);
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
          createMockRequest({ [PASSKEY_CHALLENGE_COOKIE]: legacy }),
          'login',
        )
      ).challenge,
    ).toBe('legacy-web-challenge');
    await expect(
      service.read(
        createMockRequest({ [ADMIN_CHALLENGE_COOKIE]: legacy }, ADMIN_ORIGIN),
        'login',
      ),
    ).rejects.toMatchObject(CHALLENGE_INVALID);
  });

  // Failure: a verify request is answered for the application its origin
  // names instead of the one its own signed challenge names.
  it('names the application of a verify route from the signed challenge alone', async () => {
    const config = createConfigService(WITH_ADMIN);
    const applications = browserApplicationsForTest(config);
    const service = createChallengeService(
      WITH_ADMIN,
      createChallengeStore(),
      applications,
    );
    service.onModuleInit();
    const admin = createMockResponse(ADMIN_ORIGIN);
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

import { ErrorCode } from '../../../common/enums/error-code.enum';
import { PASSKEY_CHALLENGE_COOKIE } from '../constants/passkeys.constants';
import {
  createChallengeService,
  createMockRequest,
  createMockResponse,
  USER_ID,
} from '../persistence/mongo/passkeys.harness-spec';

const CHALLENGE_INVALID = {
  code: ErrorCode.PASSKEY_CHALLENGE_INVALID,
  status: 401,
};

describe('PasskeyChallengeService', () => {
  it('signs new cookies with the dedicated key and refuses them under the old key alone', async () => {
    const dedicated = createChallengeService({
      'oauth.stateSecret': 'o'.repeat(32),
      'passkeys.challengeSecret': 'n'.repeat(32),
    });
    const { response, cookies } = createMockResponse();
    await dedicated.issue(response, 'login', 'new-key-challenge');
    expect(
      (await dedicated.read(createMockRequest(cookies), 'login')).challenge,
    ).toBe('new-key-challenge');
    await expect(
      createChallengeService({ 'oauth.stateSecret': 'o'.repeat(32) }).read(
        createMockRequest(cookies),
        'login',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_CHALLENGE_INVALID });
  });

  it('reads a previous dedicated key during rotation', async () => {
    const old = createChallengeService({
      'oauth.stateSecret': 'o'.repeat(32),
      'passkeys.challengeSecret': 'p'.repeat(32),
    });
    const { response, cookies } = createMockResponse();
    await old.issue(response, 'login', 'rotation-challenge');
    const rotated = createChallengeService({
      'oauth.stateSecret': 'o'.repeat(32),
      'passkeys.challengeSecret': 'n'.repeat(32),
      'passkeys.previousChallengeSecret': 'p'.repeat(32),
    });
    expect(
      (await rotated.read(createMockRequest(cookies), 'login')).challenge,
    ).toBe('rotation-challenge');
  });

  it('reads a legacy OAuth-derived cookie for its remaining lifetime', async () => {
    const legacy = createChallengeService({
      'oauth.stateSecret': 'o'.repeat(32),
    });
    const { response, cookies } = createMockResponse();
    await legacy.issue(response, 'login', 'legacy-challenge');
    const next = createChallengeService({
      'oauth.stateSecret': 'o'.repeat(32),
      'passkeys.challengeSecret': 'n'.repeat(32),
      'passkeys.legacyChallengeUntil': new Date(
        Date.now() + 60_000,
      ).toISOString(),
    });
    expect(
      (await next.read(createMockRequest(cookies), 'login')).challenge,
    ).toBe('legacy-challenge');
  });

  it('refuses legacy cookies when the bounded fallback is absent or over', async () => {
    const legacy = createChallengeService({
      'oauth.stateSecret': 'o'.repeat(32),
    });
    const { response, cookies } = createMockResponse();
    await legacy.issue(response, 'login', 'old-challenge');
    for (const legacyChallengeUntil of [
      undefined,
      new Date(Date.now() - 1000).toISOString(),
    ]) {
      const next = createChallengeService({
        'oauth.stateSecret': 'o'.repeat(32),
        'passkeys.challengeSecret': 'n'.repeat(32),
        ...(legacyChallengeUntil
          ? { 'passkeys.legacyChallengeUntil': legacyChallengeUntil }
          : {}),
      });
      await expect(
        next.read(createMockRequest(cookies), 'login'),
      ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_CHALLENGE_INVALID });
    }
  });

  it('should hand out a signed cookie and read it back', async () => {
    const service = createChallengeService();
    const { response, cookies } = createMockResponse();

    await service.issue(
      response,
      'register',
      'challenge-value',
      USER_ID.toString(),
    );

    const raw = cookies[PASSKEY_CHALLENGE_COOKIE];
    expect(raw).toEqual(expect.stringContaining('.'));

    const payload = await service.read(
      createMockRequest({ [PASSKEY_CHALLENGE_COOKIE]: raw }),
      'register',
    );

    expect(payload.challenge).toBe('challenge-value');
    expect(payload.sub).toBe(USER_ID.toString());
  });

  it('should leave the sign-in challenge without an account on it', async () => {
    const service = createChallengeService();
    const { response, cookies } = createMockResponse();

    await service.issue(response, 'login', 'challenge-value');
    const payload = await service.read(
      createMockRequest({
        [PASSKEY_CHALLENGE_COOKIE]: cookies[PASSKEY_CHALLENGE_COOKIE],
      }),
      'login',
    );

    expect(payload.sub).toBeUndefined();
  });

  it('should refuse a challenge issued for the other ceremony', async () => {
    const service = createChallengeService();
    const { response, cookies } = createMockResponse();

    await service.issue(
      response,
      'register',
      'challenge-value',
      USER_ID.toString(),
    );

    await expect(
      service.read(
        createMockRequest({
          [PASSKEY_CHALLENGE_COOKIE]: cookies[PASSKEY_CHALLENGE_COOKIE],
        }),
        'login',
      ),
    ).rejects.toMatchObject(CHALLENGE_INVALID);
  });

  it('should refuse an edited payload', async () => {
    const service = createChallengeService();
    const { response, cookies } = createMockResponse();
    await service.issue(response, 'login', 'challenge-value');

    const [, signature] = cookies[PASSKEY_CHALLENGE_COOKIE].split('.');
    const forged = Buffer.from(
      JSON.stringify({
        purpose: 'login',
        challenge: 'other-value',
        expiresAt: Date.now() + 60000,
      }),
    ).toString('base64url');

    await expect(
      service.read(
        createMockRequest({
          [PASSKEY_CHALLENGE_COOKIE]: `${forged}.${signature}`,
        }),
        'login',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_CHALLENGE_INVALID });
  });

  it('should refuse a cookie signed with another secret', async () => {
    const issuer = createChallengeService();
    const { response, cookies } = createMockResponse();
    await issuer.issue(response, 'login', 'challenge-value');

    const other = createChallengeService({
      'oauth.stateSecret': 'a'.repeat(32),
    });

    await expect(
      other.read(
        createMockRequest({
          [PASSKEY_CHALLENGE_COOKIE]: cookies[PASSKEY_CHALLENGE_COOKIE],
        }),
        'login',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_CHALLENGE_INVALID });
  });

  it('should refuse an expired challenge', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const service = createChallengeService();
    const { response, cookies } = createMockResponse();
    await service.issue(response, 'login', 'challenge-value');

    jest.setSystemTime(new Date('2026-01-01T00:06:00.000Z'));

    await expect(
      service.read(
        createMockRequest({
          [PASSKEY_CHALLENGE_COOKIE]: cookies[PASSKEY_CHALLENGE_COOKIE],
        }),
        'login',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_CHALLENGE_INVALID });

    jest.useRealTimers();
  });

  it('should refuse a request with no cookie at all', async () => {
    await expect(
      createChallengeService().read(createMockRequest({}), 'login'),
    ).rejects.toMatchObject({ code: ErrorCode.PASSKEY_CHALLENGE_INVALID });
  });

  it('should report 503 when the signing secret is missing', async () => {
    const service = createChallengeService({ NODE_ENV: 'test' });
    const { response } = createMockResponse();

    await expect(
      service.issue(response, 'login', 'challenge-value'),
    ).rejects.toMatchObject({
      code: ErrorCode.PASSKEY_NOT_CONFIGURED,
      status: 503,
    });
  });

  it('should clear the cookie it set', () => {
    const service = createChallengeService();
    const { response, cleared } = createMockResponse();

    service.clear(response);

    expect(cleared).toEqual([PASSKEY_CHALLENGE_COOKIE]);
  });
});

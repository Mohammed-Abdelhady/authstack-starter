import { FIRST_FACTOR } from '../../../../src/auth/services/sessions/first-factor';
import { ROLE_AUDIENCE } from '../../../../src/host/types/host-role.type';
import {
  WEB_APPLICATION,
  rerunAtOnce,
  rejectionOf,
  storedCounts,
  type HarnessSource,
} from './issuance-contract-support';

export function issuancePasskeyCases(harness: HarnessSource): void {
  // Failure: direct issuance reports passkey policy before a failing audience.
  it.each(['preflight', 'issuer'])(
    'prefers audience refusal at the %s when both policies fail',
    async (path) => {
      const h = harness();
      const userId = await h.seedAccount({ audience: ROLE_AUDIENCE.CUSTOMER });
      await h.seedApplication({
        ...WEB_APPLICATION,
        accountAudience: ROLE_AUDIENCE.STAFF,
        requirePasskey: true,
      });
      const service = h.service(rerunAtOnce);
      await expect(
        path === 'preflight'
          ? service.assertAdmission(userId, WEB_APPLICATION.clientId)
          : service.createBrowserSession(
              userId,
              'required-passkey',
              '127.0.0.1',
              WEB_APPLICATION.clientId,
            ),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
      expect(await h.sessions(userId)).toEqual([]);
      expect(await h.events()).toEqual([
        {
          action: 'audience_refused',
          outcome: 'failed',
          targetUserId: userId,
          clientId: WEB_APPLICATION.clientId,
          sessionId: null,
        },
      ]);
    },
  );

  // Failure: another factor or an unverified assertion bypasses required UV.
  it.each([
    [FIRST_FACTOR.PASSWORD, true],
    [FIRST_FACTOR.MAGIC_LINK, true],
    [FIRST_FACTOR.PROVIDER, true],
    [FIRST_FACTOR.EMAIL_CODE, true],
    [FIRST_FACTOR.PASSKEY, false],
    ['', true],
  ] as const)(
    'refuses %s with UV %s before session or grant writes',
    async (method, userVerified) => {
      const h = harness();
      const userId = await h.seedAccount();
      await h.seedApplication({ ...WEB_APPLICATION, requirePasskey: true });
      const error = await rejectionOf(
        h
          .service(rerunAtOnce)
          .createBrowserSession(
            userId,
            'required-passkey',
            '127.0.0.1',
            WEB_APPLICATION.clientId,
            { authenticationMethods: method ? [method] : [], userVerified },
          ),
      );
      expect(error).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
      expect(await storedCounts(h, userId)).toEqual({
        sessions: 0,
        grants: 0,
        grantFences: [],
        accountFence: 0,
        events: 1,
      });
      expect(await h.events()).toEqual([
        {
          action: 'passkey_required',
          outcome: 'failed',
          targetUserId: userId,
          clientId: WEB_APPLICATION.clientId,
          sessionId: null,
        },
      ]);
    },
  );

  // Failure: verified passkey evidence is lost at the final issuer.
  it('issues a required session with verified passkey evidence', async () => {
    const h = harness();
    const userId = await h.seedAccount();
    await h.seedApplication({
      ...WEB_APPLICATION,
      requirePasskey: true,
      policyVersion: 3,
    });
    await h
      .service(rerunAtOnce)
      .createBrowserSession(
        userId,
        'required-passkey',
        '127.0.0.1',
        WEB_APPLICATION.clientId,
        { authenticationMethods: [FIRST_FACTOR.PASSKEY], userVerified: true },
      );
    expect(await h.sessions(userId)).toEqual([
      expect.objectContaining({
        authenticationMethods: ['passkey'],
        userVerified: true,
        policyVersion: 3,
      }),
    ]);
  });
}

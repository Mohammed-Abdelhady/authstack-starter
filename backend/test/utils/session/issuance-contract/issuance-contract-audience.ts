import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../../../src/host/types/host-role.type';
import {
  ADMIN_APPLICATION,
  WEB_APPLICATION,
  rerunAtOnce,
  rejectionOf,
  storedCounts,
  type HarnessSource,
} from './issuance-contract-support';

export function issuanceAudienceCases(harness: HarnessSource): void {
  it.each([
    [ROLE_AUDIENCE.CUSTOMER, ROLE_AUDIENCE.STAFF],
    [ROLE_AUDIENCE.STAFF, ROLE_AUDIENCE.CUSTOMER],
    [undefined, ROLE_AUDIENCE.STAFF],
  ] satisfies [RoleAudience | undefined, RoleAudience][])(
    'refuses %s at a %s application without writes and retains the failure event',
    async (audience, applicationAudience) => {
      const h = harness();
      const userId = await h.seedAccount({ audience });
      await h.seedApplication({
        ...ADMIN_APPLICATION,
        accountAudience: applicationAudience,
      });
      const error = await rejectionOf(
        h
          .service(rerunAtOnce)
          .createBrowserSession(
            userId,
            'audience-contract',
            '127.0.0.1',
            ADMIN_APPLICATION.clientId,
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
          action: 'audience_refused',
          outcome: 'failed',
          targetUserId: userId,
          clientId: ADMIN_APPLICATION.clientId,
          sessionId: null,
        },
      ]);
    },
  );

  it.each([ROLE_AUDIENCE.CUSTOMER, ROLE_AUDIENCE.STAFF])(
    'admits %s to matching and unrestricted applications',
    async (audience) => {
      const h = harness();
      const userId = await h.seedAccount({ audience });
      await h.seedApplication({
        ...ADMIN_APPLICATION,
        accountAudience: audience,
      });
      const service = h.service(rerunAtOnce);
      await service.createBrowserSession(
        userId,
        'contract',
        '127.0.0.1',
        ADMIN_APPLICATION.clientId,
      );
      await service.createBrowserSession(
        userId,
        'contract',
        '127.0.0.1',
        WEB_APPLICATION.clientId,
      );
      expect(
        (await h.sessions(userId)).map((session) => session.clientId).sort(),
      ).toEqual(['admin', 'web']);
      expect((await h.events()).map((event) => event.action)).toEqual([
        'session_issued',
        'session_issued',
      ]);
    },
  );
}

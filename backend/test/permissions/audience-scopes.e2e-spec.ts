import { ConfigService } from '@nestjs/config';
import { reconcileStartupApplications } from '../../src/session/session.module';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../src/session/constants/client-ids';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
  SCOPE_SEARCH,
  arrangeAudiences,
  audienceRequest,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

interface ListedUsers {
  data: {
    data: { id: string }[];
    pagination: { total: number; totalPages: number };
  };
}

describe('audience permissions on admin users', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) =>
        app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  // Failure: inherited scopes expose the other audience's IDs or counts.
  it.each([
    {
      name: 'customer',
      permissions: ['users:list:all', 'users:read:all'],
      expected: 'customerId',
      refused: 'staffId',
    },
    {
      name: 'staff',
      permissions: ['users:list:staff', 'users:read:staff'],
      expected: 'staffId',
      refused: 'customerId',
    },
  ] as const)(
    'applies inherited $name scopes before ID access and pagination',
    async ({ permissions, expected, refused }) => {
      const fixture = await arrangeAudiences(e2e, [...permissions]);
      const issued = await issueAudienceBrowser(e2e, fixture.actorId);
      await audienceRequest(
        e2e,
        issued,
        `/api/admin/users/${fixture[expected]}`,
      ).expect(200);
      await audienceRequest(
        e2e,
        issued,
        `/api/admin/users/${fixture[refused]}`,
      ).expect(403);
      const listed = await audienceRequest(e2e, issued, '/api/admin/users')
        .query({ search: SCOPE_SEARCH, page: 1, limit: 1 })
        .expect(200);
      const body = listed.body as ListedUsers;
      expect(body.data.data.map(({ id }) => id)).toEqual([fixture[expected]]);
      expect(body.data.pagination).toMatchObject({
        total: 1,
        totalPages: 1,
      });
      const beyond = await audienceRequest(e2e, issued, '/api/admin/users')
        .query({ search: SCOPE_SEARCH, page: 2, limit: 1 })
        .expect(200);
      expect((beyond.body as ListedUsers).data.data).toEqual([]);
      expect((beyond.body as ListedUsers).data.pagination.total).toBe(1);
    },
  );

  // Failure: staff wildcard no longer spans both account audiences.
  it('lets a staff wildcard read both audiences', async () => {
    const fixture = await arrangeAudiences(e2e, ['*']);
    const issued = await issueAudienceBrowser(e2e, fixture.actorId);
    const listed = await audienceRequest(e2e, issued, '/api/admin/users')
      .query({ search: SCOPE_SEARCH })
      .expect(200);
    expect(
      (listed.body as ListedUsers).data.data.map(({ id }) => id).sort(),
    ).toEqual([fixture.customerId, fixture.staffId].sort());
    expect((listed.body as ListedUsers).data.pagination.total).toBe(2);
  });

  // Failure: the admin application's audience becomes the created customer's.
  it('creates a customer from its selected role through the staff admin application', async () => {
    const fixture = await arrangeAudiences(e2e);
    const issued = await issueAudienceBrowser(e2e, fixture.adminId);
    const email = 'staff-created-customer@example.test';
    await audienceRequest(e2e, issued, '/api/admin/users', 'post')
      .send({
        email,
        name: 'Created Customer',
        password: 'CustomerPassword1!',
        role: 'user',
      })
      .expect(201);
    expect(await e2e.state.accounts.accountWithAddress(email)).toMatchObject({
      role: 'user',
      audience: 'customer',
      isVerified: true,
    });
    expect(
      (await e2e.state.applications.application(ADMIN_CLIENT_ID))
        ?.accountAudience,
    ).toBe('staff');
  });

  // Failure: customer-only settings accidentally enable the staff browser guard.
  it('keeps StaffGuard dormant for customer-only settings while filtering scopes', async () => {
    const fixture = await arrangeAudiences(e2e);
    e2e.app.get(ConfigService).set('auth.admin.signIn', {
      audience: ROLE_AUDIENCE.CUSTOMER,
    });
    await reconcileStartupApplications(e2e.app);
    const issued = await issueAudienceBrowser(
      e2e,
      fixture.actorId,
      WEB_CLIENT_ID,
    );
    const listed = await audienceRequest(
      e2e,
      issued,
      '/api/admin/users',
      'get',
      WEB_CLIENT_ID,
    )
      .query({ search: SCOPE_SEARCH })
      .expect(200);
    expect((listed.body as ListedUsers).data.data.map(({ id }) => id)).toEqual([
      fixture.customerId,
    ]);
    expect((listed.body as ListedUsers).data.pagination.total).toBe(1);
  });

  // Failure: a customer actor's :all grant exposes staff while StaffGuard is dormant.
  it('refuses staff targets for a customer actor in a customer-only deployment', async () => {
    const fixture = await arrangeAudiences(e2e, ['users:read:all'], {
      actorAudience: ROLE_AUDIENCE.CUSTOMER,
      staffApplication: false,
    });
    expect(
      await e2e.state.accounts.accountWithId(fixture.actorId),
    ).toMatchObject({ audience: ROLE_AUDIENCE.CUSTOMER });
    const issued = await issueAudienceBrowser(
      e2e,
      fixture.actorId,
      WEB_CLIENT_ID,
    );
    await audienceRequest(
      e2e,
      issued,
      `/api/admin/users/${fixture.customerId}`,
      'get',
      WEB_CLIENT_ID,
    ).expect(200);
    await audienceRequest(
      e2e,
      issued,
      `/api/admin/users/${fixture.staffId}`,
      'get',
      WEB_CLIENT_ID,
    ).expect(403);
  });

  // Failure: metadata alone changes scopes or imposes a staff browser guard.
  it('preserves web access and unfiltered authority without named audiences', async () => {
    const fixture = await arrangeAudiences(e2e);
    e2e.app.get(ConfigService).set('auth.admin.signIn', undefined);
    await reconcileStartupApplications(e2e.app);
    const issued = await issueAudienceBrowser(
      e2e,
      fixture.actorId,
      WEB_CLIENT_ID,
    );
    const listed = await audienceRequest(
      e2e,
      issued,
      '/api/admin/users',
      'get',
      WEB_CLIENT_ID,
    )
      .query({ search: SCOPE_SEARCH })
      .expect(200);
    expect(
      (listed.body as ListedUsers).data.data.map(({ id }) => id).sort(),
    ).toEqual([fixture.customerId, fixture.staffId].sort());
    expect((listed.body as ListedUsers).data.pagination.total).toBe(2);
  });
});

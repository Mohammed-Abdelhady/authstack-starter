import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { StaffGuard } from '../../src/auth/guards/staff.guard';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { createExecutionContextMock } from '../../src/common/testing/test-doubles.harness-spec';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../src/session/constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../../src/session/constants/credential-purpose';
import { storeBrowserPolicy } from '../utils/session/store-browser-policy';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { SEED_USER } from '../constants/seed-users';
import {
  createNativeApplication,
  issueNativeGrantFor,
  NATIVE_CLIENT_ID,
} from '../utils/native/native-authorize.fixtures';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
  audienceRequest,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const STAFF_ROUTE = '/api/admin/users';
const PROFILE_ROUTE = '/api/user/profile';

describe('staff routes require a full admin browser credential', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      beforeStart: (app) =>
        app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  // Failure: a valid staff web session is accepted on the admin surface.
  it('refuses a staff web session while its profile remains accessible', async () => {
    const fixture = await arrangeAudiences(e2e, ['*']);
    const issued = await issueAudienceBrowser(
      e2e,
      fixture.actorId,
      WEB_CLIENT_ID,
    );
    await audienceRequest(
      e2e,
      issued,
      PROFILE_ROUTE,
      'get',
      WEB_CLIENT_ID,
    ).expect(200);
    await audienceRequest(
      e2e,
      issued,
      STAFF_ROUTE,
      'get',
      WEB_CLIENT_ID,
    ).expect(403);
    const admin = await issueAudienceBrowser(e2e, fixture.actorId);
    await audienceRequest(e2e, admin, STAFF_ROUTE).expect(200);
  });

  // Failure: admitting staff to native bypasses the browser-only staff guard.
  it('refuses valid staff native access when its application admits staff', async () => {
    const fixture = await arrangeAudiences(e2e, ['*']);
    await createNativeApplication(e2e);
    await e2e.state.applications.changeApplication(NATIVE_CLIENT_ID, {
      accountAudience: ROLE_AUDIENCE.STAFF,
    });
    expect(
      (await e2e.state.applications.application(NATIVE_CLIENT_ID))
        ?.accountAudience,
    ).toBe('staff');
    const actor = await e2e.state.accounts.accountWithId(fixture.actorId);
    if (!actor) throw new Error('staff actor is missing');
    const issued = await issueNativeGrantFor(e2e, actor.email);
    await request(e2e.httpServer)
      .get(PROFILE_ROUTE)
      .set('Authorization', `Bearer ${issued.accessToken}`)
      .expect(200);
    await request(e2e.httpServer)
      .get(STAFF_ROUTE)
      .set('Authorization', `Bearer ${issued.accessToken}`)
      .expect(403);
  });

  // Failure: customer-management authority on mobile authorizes a staff route.
  it('refuses a valid mobile customer carrying users read all', async () => {
    await arrangeAudiences(e2e);
    const customer = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!customer) throw new Error('customer fixture is missing');
    await e2e.state.records.replaceAccountPermissions(customer, [
      'users:read:all',
    ]);
    await createNativeApplication(e2e);
    const issued = await issueNativeGrantFor(e2e, SEED_USER.email);
    await request(e2e.httpServer)
      .get(PROFILE_ROUTE)
      .set('Authorization', `Bearer ${issued.accessToken}`)
      .expect(200);
    await request(e2e.httpServer)
      .get(`${STAFF_ROUTE}/${customer}`)
      .set('Authorization', `Bearer ${issued.accessToken}`)
      .expect(403);
  });

  // Failure: weak evidence satisfies a verified-passkey staff requirement.
  it.each([
    { methods: ['password'], verified: false, status: 403 },
    { methods: ['passkey'], verified: false, status: 403 },
    { methods: ['password'], verified: true, status: 403 },
    { methods: ['passkey'], verified: true, status: 200 },
  ])(
    'requires passkey with user verification: $methods / $verified',
    async ({ methods, verified, status }) => {
      const fixture = await arrangeAudiences(e2e, ['*']);
      const issued = await issueAudienceBrowser(
        e2e,
        fixture.actorId,
        undefined,
        { authenticationMethods: methods, userVerified: verified },
      );
      await storeBrowserPolicy(
        e2e,
        ADMIN_CLIENT_ID,
        { requirePasskey: true },
        false,
      );
      await audienceRequest(e2e, issued, PROFILE_ROUTE).expect(200);
      await audienceRequest(e2e, issued, STAFF_ROUTE).expect(status);
    },
  );

  // Failure: incomplete authority or customer identity passes solely on wildcard.
  it('refuses a non-browser purpose and customer identity at the guard boundary', async () => {
    const fixture = await arrangeAudiences(e2e, ['*']);
    const issued = await issueAudienceBrowser(e2e, fixture.actorId);
    const session = await e2e.app
      .get(Sessions)
      .validateSessionWithoutExtendingIdle(issued.sessionToken);
    if (!session?.user) {
      throw new Error('the issued staff session did not validate');
    }
    const guard = e2e.app.get(StaffGuard);
    for (const candidate of [
      {
        ...session,
        credentialPurpose: CREDENTIAL_PURPOSE.PENDING_AUTHENTICATION,
      },
      {
        ...session,
        user: { ...session.user, audience: ROLE_AUDIENCE.CUSTOMER },
      },
    ]) {
      const context = createExecutionContextMock({
        switchToHttp: () => ({ getRequest: () => ({ session: candidate }) }),
      });
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    }
  });
});

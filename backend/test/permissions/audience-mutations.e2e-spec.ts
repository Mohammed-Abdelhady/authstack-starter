import { ConfigService } from '@nestjs/config';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
  STAFF_TARGET_ROLE,
  arrangeAudiences,
  audienceRequest,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const NEW_STAFF_EMAIL = 'scope-refused-staff@example.test';

// Failure: a customer-management permission can create, change or delete staff.
describe('customer management scopes protect staff writes', () => {
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

  it.each([
    { action: 'create', permission: 'users:create:all' },
    { action: 'update', permission: 'users:update:all' },
    { action: 'delete', permission: 'users:delete:all' },
  ])(
    'refuses $action with $permission before changing staff data',
    async ({ action, permission }) => {
      const fixture = await arrangeAudiences(e2e, [permission]);
      const issued = await issueAudienceBrowser(e2e, fixture.actorId);
      const before = await e2e.state.accounts.accountWithId(fixture.staffId);
      if (action === 'create') {
        await audienceRequest(e2e, issued, '/api/admin/users', 'post')
          .send({
            email: NEW_STAFF_EMAIL,
            name: 'Refused Staff',
            password: 'RefusedStaffPassword1!',
            role: STAFF_TARGET_ROLE,
          })
          .expect(403);
        expect(
          await e2e.state.accounts.accountWithAddress(NEW_STAFF_EMAIL),
        ).toBeNull();
      } else if (action === 'update') {
        await audienceRequest(
          e2e,
          issued,
          `/api/admin/users/${fixture.staffId}`,
          'patch',
        )
          .send({ name: 'Changed Staff' })
          .expect(403);
      } else {
        await audienceRequest(
          e2e,
          issued,
          `/api/admin/users/${fixture.staffId}`,
          'delete',
        ).expect(403);
      }
      expect(await e2e.state.accounts.accountWithId(fixture.staffId)).toEqual(
        before,
      );
    },
  );
});

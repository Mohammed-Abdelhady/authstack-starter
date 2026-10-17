import { ConfigService } from '@nestjs/config';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
  issueAudienceBrowser,
  type AudienceFixture,
} from '../utils/audience-authorization.fixtures';
import { apiErrorOf } from '../utils/sdk/sdk-transport';
import { staffClient } from '../utils/sdk/staff-browser-client';
// feature:invitations:start
import { InvitationStore } from '../../src/auth/invitations/stores/invitation.store';
// feature:invitations:end

function observedVersion(value: number | undefined): number {
  if (value === undefined)
    throw new Error('Permission response did not include a version');
  return value;
}

async function permissionVersionRoundTrip(
  client: ReturnType<typeof staffClient>,
  userId: string,
) {
  const listed = await client.admin.permissions.list(userId);
  expect(listed.version).toBe(2);
  const granted = await client.admin.permissions.grant(userId, {
    permission: 'profile:update:own',
    version: observedVersion(listed.version),
  });
  expect(granted).toMatchObject({ userId, version: 3 });
  expect((await client.admin.accounts.get(userId)).version).toBe(3);
  expect(
    await apiErrorOf(
      client.admin.permissions.revoke(userId, 'profile:update:own', {
        version: observedVersion(listed.version),
      }),
    ),
  ).toMatchObject({ status: 409 });
  const removed = await client.admin.permissions.revoke(
    userId,
    'profile:update:own',
    {
      version: observedVersion(granted.version),
    },
  );
  expect(removed).toEqual({ userId, permissions: [], version: 4 });
  expect((await client.admin.permissions.list(userId)).version).toBe(4);
}

describe('SDK staff writes over real cookie HTTP', () => {
  let e2e: E2eApp;
  let fixture: AudienceFixture;
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) =>
        app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    fixture = await arrangeAudiences(e2e, ['*']);
    e2e.app.get(ConfigService).set('admin.strictMutations', true);
  });

  it('carries actual versions through edits and DELETE queries and refuses stale/omitted writes', async () => {
    const client = staffClient(e2e, {
      issued: await issueAudienceBrowser(e2e, fixture.adminId),
    });
    await issueAudienceBrowser(e2e, fixture.staffId);
    const target = await client.admin.accounts.get(fixture.staffId);
    expect(target.lastActiveAt).toBe(TEST_NOW.toISOString());
    expect(target.version).toBe(1);
    const updated = await client.admin.accounts.update(target.id, {
      name: 'SDK edited staff',
      version: target.version,
    });
    expect(updated).toMatchObject({
      name: 'SDK edited staff',
      version: 2,
      lastActiveAt: TEST_NOW.toISOString(),
    });
    expect(
      await apiErrorOf(
        client.admin.accounts.update(target.id, {
          name: 'Stale overwrite',
          version: 0,
        }),
      ),
    ).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(
      await apiErrorOf(
        client.admin.accounts.update(target.id, { name: 'Missing version' }),
      ),
    ).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect((await client.admin.accounts.get(target.id)).name).toBe(
      'SDK edited staff',
    );
    await permissionVersionRoundTrip(client, target.id);
    expect(
      await client.admin.accounts.updateStatus(target.id, {
        isActive: false,
        version: 4,
      }),
    ).toMatchObject({ id: target.id, isDeleted: true, version: 5 });
    expect(
      await client.admin.accounts.updateStatus(target.id, {
        isActive: true,
        version: 5,
      }),
    ).toMatchObject({ id: target.id, isDeleted: false, version: 6 });
    expect(
      await apiErrorOf(client.admin.accounts.delete(target.id)),
    ).toMatchObject({ status: 400 });
    expect(
      await apiErrorOf(client.admin.accounts.delete(target.id, { version: 5 })),
    ).toMatchObject({ status: 409 });
    await client.admin.accounts.delete(target.id, { version: 6 });
    expect(
      await e2e.state.accounts.accountWithAddress(target.email),
    ).toMatchObject({ isDeleted: true });
  });

  it('carries role and role-assignment versions through the actual SDK writes', async () => {
    const client = staffClient(e2e, {
      issued: await issueAudienceBrowser(e2e, fixture.adminId),
    });
    const target = await client.admin.accounts.get(fixture.staffId);
    const role = await client.admin.roles.create(
      {
        name: 'SDK staff role',
        audience: 'staff',
        level: 1,
        permissions: ['profile:read:own'],
      },
      { operation: { operationKey: 'sdk-role-create' } },
    );
    expect(role).toMatchObject({ version: 0, audience: 'staff' });
    expect(
      await client.admin.roles.update(role.id, {
        description: 'SDK role edit',
        level: 2,
        version: 0,
      }),
    ).toMatchObject({ version: 1, description: 'SDK role edit', level: 2 });
    expect(
      await client.admin.accounts.updateRole(target.id, {
        role: role.slug,
        version: 1,
      }),
    ).toMatchObject({ id: target.id, role: role.slug, version: 2 });
    expect(
      await apiErrorOf(client.admin.roles.delete(role.id, { version: 0 })),
    ).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(
      await apiErrorOf(client.admin.roles.delete(role.id, { version: 1 })),
    ).toMatchObject({ status: 400, code: 'ROLE_HAS_USERS' });
    expect(
      await client.admin.accounts.updateRole(target.id, {
        role: target.role,
        version: 2,
      }),
    ).toMatchObject({ id: target.id, role: target.role, version: 3 });
    await client.admin.roles.delete(role.id, { version: 1 });
    expect(await apiErrorOf(client.admin.roles.get(role.id))).toMatchObject({
      status: 404,
    });
  });

  it('retains compatibility without a version when strict policy is off', async () => {
    e2e.app.get(ConfigService).set('admin.strictMutations', false);
    const client = staffClient(e2e, {
      issued: await issueAudienceBrowser(e2e, fixture.adminId),
    });
    const updated = await client.admin.accounts.update(fixture.staffId, {
      name: 'Compatible SDK edit',
    });
    expect(updated).toMatchObject({ name: 'Compatible SDK edit', version: 2 });
    expect((await client.admin.accounts.get(fixture.staffId)).name).toBe(
      'Compatible SDK edit',
    );
  });

  // feature:invitations:start
  const INVITATION_LOCALES = [
    'en',
    'ar', // feature:locale-ar
  ] as const;
  const SELECTED_LOCALE = INVITATION_LOCALES.at(-1) ?? 'en';

  it('replays a committed invitation after a lost reply, then resends and revokes the actual row', async () => {
    const client = staffClient(e2e, {
      issued: await issueAudienceBrowser(e2e, fixture.adminId),
      loseReplyAt: '/api/admin/invitations',
    });
    const invitationRole = await client.admin.roles.get('user');
    const body = {
      email: 'sdk-invited@example.test',
      role: invitationRole.slug,
      expectedRoleId: invitationRole.id,
      expectedAudience: invitationRole.audience ?? null,
      name: 'SDK invitee',
      locale: SELECTED_LOCALE,
    };
    const options = { operation: { operationKey: 'sdk-invitation-create' } };
    const before = (await e2e.captureMail()).length;
    await expect(
      client.admin.invitations.create(body, options),
    ).rejects.toMatchObject({
      name: 'UnknownOutcomeError',
      operationKey: 'sdk-invitation-create',
    });
    const original = await client.admin.invitations.create(body, options);
    expect(original).toMatchObject({
      email: body.email,
      role: 'user',
      status: 'pending',
    });
    const page = await client.admin.invitations.list({ page: 1, limit: 20 });
    expect(page.total).toBe(1);
    expect(page.invitations.map(({ id }) => id)).toEqual([original.id]);
    expect((await e2e.captureMail()).length).toBe(before + 1);
    expect(
      await e2e.app.get(InvitationStore).findById(original.id),
    ).toMatchObject({ email: body.email, locale: SELECTED_LOCALE });
    expect(original).not.toHaveProperty('token');
    const resent = await client.admin.invitations.resend(original.id);
    expect(resent.id).toBe(original.id);
    expect((await e2e.captureMail()).length).toBe(before + 2);
    await client.admin.invitations.revoke(original.id);
    expect(
      (await e2e.app.get(InvitationStore).findById(original.id))?.revokedAt,
    ).toEqual(TEST_NOW);
    expect(
      (await client.admin.invitations.list({ status: 'revoked' })).total,
    ).toBe(1);
  });
  // feature:invitations:end
});

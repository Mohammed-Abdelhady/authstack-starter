import { API_PATHS } from '@app/sdk';
import { ConfigService } from '@nestjs/config';
import {
  PROFILE_PERMISSIONS,
  ROLE_PERMISSIONS,
  SESSION_PERMISSIONS,
  USER_PERMISSIONS,
} from '../../src/common/constants/permissions';
import { RoleSeedService } from '../../src/database/seeds/role.seed';
import { SeedStore } from '../../src/database/seeds/seed.store';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { UserRole } from '../../src/user/enums/user-role.enum';
import { SEED_MANAGER } from '../constants/seed-users';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import { setConfigValue } from '../utils/config-settings';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  ADMIN_ORIGIN,
  STAFF_TARGET_ROLE,
  audienceRequest,
} from '../utils/audience-authorization.fixtures';
import { staffClient } from '../utils/sdk/staff-browser-client';
import {
  assignmentAuthority,
  assignmentFixture,
  assignmentRole,
  assignFixtureRole,
  expectAssignmentSession,
  provedAssignmentActor,
} from '../utils/permissions/role-assignment-http';

const UPDATED_NAME = 'Updated customer';

const LEGACY_MANAGER_PERMISSIONS = [
  PROFILE_PERMISSIONS.READ_OWN,
  PROFILE_PERMISSIONS.UPDATE_OWN,
  USER_PERMISSIONS.READ_ALL,
  USER_PERMISSIONS.UPDATE_ALL,
  USER_PERMISSIONS.SUSPEND_ALL,
  SESSION_PERMISSIONS.READ_ALL,
  ROLE_PERMISSIONS.READ_ALL,
];

describe('Account role-assignment capability', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) =>
        setConfigValue(app.get(ConfigService), 'cors.adminUrl', ADMIN_ORIGIN),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(() => e2e.clock.set(TEST_NOW));

  it('refuses ordinary customer-update authority without changing target authority', async () => {
    const fixture = await assignmentFixture(e2e, {
      permissions: [USER_PERMISSIONS.UPDATE_ALL, PROFILE_PERMISSIONS.READ_OWN],
    });
    expect(await assignmentAuthority(e2e, fixture.targetId)).toEqual({
      role: UserRole.USER,
      version: 1,
      sessionVersion: 0,
    });

    await assignFixtureRole(e2e, fixture).expect(403);

    expect(await assignmentAuthority(e2e, fixture.targetId)).toEqual({
      role: UserRole.USER,
      version: 1,
      sessionVersion: 0,
    });
    await expectAssignmentSession(e2e, fixture, true);
    await audienceRequest(
      e2e,
      fixture.actor,
      API_PATHS.admin.account(fixture.targetId),
      'patch',
    )
      .send({ name: UPDATED_NAME, version: 1 })
      .expect(200);
    expect(
      (await e2e.state.accounts.accountWithId(fixture.targetId))?.name,
    ).toBe(UPDATED_NAME);
  });

  it('accepts explicit assignment authority without profile or role-definition editing', async () => {
    const fixture = await assignmentFixture(e2e, {
      permissions: [
        USER_PERMISSIONS.ASSIGN_ROLE_ALL,
        PROFILE_PERMISSIONS.READ_OWN,
      ],
    });
    await audienceRequest(
      e2e,
      fixture.actor,
      API_PATHS.admin.account(fixture.targetId),
      'patch',
    )
      .send({ name: 'Refused customer edit', version: 1 })
      .expect(403);
    await audienceRequest(
      e2e,
      fixture.actor,
      API_PATHS.admin.role(fixture.assignedRoleId),
      'patch',
    )
      .send({ description: 'Refused role edit', version: 0 })
      .expect(403);

    await assignFixtureRole(e2e, fixture).expect(200);

    expect(await assignmentAuthority(e2e, fixture.targetId)).toEqual({
      role: fixture.assignedRole,
      version: 2,
      sessionVersion: 1,
    });
    await expectAssignmentSession(e2e, fixture, false);
  });

  it('refuses customer assignment capability for a lower-level staff target', async () => {
    const fixture = await assignmentFixture(e2e, {
      permissions: [
        USER_PERMISSIONS.ASSIGN_ROLE_ALL,
        USER_PERMISSIONS.UPDATE_STAFF,
        PROFILE_PERMISSIONS.READ_OWN,
      ],
      targetAudience: ROLE_AUDIENCE.STAFF,
    });
    expect(await assignmentAuthority(e2e, fixture.targetId)).toEqual({
      role: STAFF_TARGET_ROLE,
      version: 1,
      sessionVersion: 0,
    });

    await assignFixtureRole(e2e, fixture).expect(403);

    expect(await assignmentAuthority(e2e, fixture.targetId)).toEqual({
      role: STAFF_TARGET_ROLE,
      version: 1,
      sessionVersion: 0,
    });
    await expectAssignmentSession(e2e, fixture, true);
  });

  it('preserves stored Manager grants until an explicit role grant authorizes assignment', async () => {
    const fixture = await assignmentFixture(e2e, {
      permissions: [USER_PERMISSIONS.UPDATE_ALL, PROFILE_PERMISSIONS.READ_OWN],
    });
    const managerId = await e2e.state.accounts.accountIdFor(SEED_MANAGER.email);
    if (!managerId) throw new Error('Manager account was not seeded');
    await e2e.app
      .get(SeedStore)
      .replaceRolePermissions(UserRole.MANAGER, LEGACY_MANAGER_PERMISSIONS);
    await e2e.state.records.replaceAccountPermissions(managerId, []);
    await e2e.app.get(RoleSeedService).seed();
    const oldRole = await assignmentRole(e2e, UserRole.MANAGER);
    expect(oldRole.permissions).toEqual(LEGACY_MANAGER_PERMISSIONS);
    expect(
      (await e2e.state.accounts.accountWithId(managerId))?.permissions,
    ).toEqual([]);
    const manager = await provedAssignmentActor(e2e, managerId);

    await assignFixtureRole(e2e, fixture, manager).expect(403);

    expect(await assignmentAuthority(e2e, fixture.targetId)).toEqual({
      role: UserRole.USER,
      version: 1,
      sessionVersion: 0,
    });
    await expectAssignmentSession(e2e, fixture, true);
    const owner = staffClient(e2e, {
      issued: await provedAssignmentActor(e2e, fixture.adminId),
    });
    await owner.admin.roles.update(oldRole.id, {
      permissions: [
        ...LEGACY_MANAGER_PERMISSIONS,
        USER_PERMISSIONS.ASSIGN_ROLE_ALL,
      ],
      version: oldRole.version ?? 0,
    });
    const authorized = await provedAssignmentActor(e2e, managerId);

    await assignFixtureRole(e2e, fixture, authorized).expect(200);

    expect(await assignmentAuthority(e2e, fixture.targetId)).toEqual({
      role: fixture.assignedRole,
      version: 2,
      sessionVersion: 1,
    });
    await expectAssignmentSession(e2e, fixture, false);
  });
});

import { API_PATHS } from '@app/sdk';
import { ConfigService } from '@nestjs/config';
import { AdminAccountStore } from '../../../src/admin/stores/admin-account.store';
import { Sessions } from '../../../src/auth/services/sessions/sessions';
import { PROFILE_PERMISSIONS } from '../../../src/common/constants/permissions';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../../src/host/types/host-role.type';
import { RoleChangeStore } from '../../../src/role/stores/role-change.store';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../../src/session/constants/client-ids';
import { SECURITY_EVENT_ACTION } from '../../../src/session/constants/security-event-action';
import { SecurityEventStore } from '../../../src/session/events/security-event.store';
import type { IssuedBrowserSession } from '../../../src/session/services/session-issuance.service';
import type { E2eApp } from '../e2e-app';
import { setConfigValue } from '../config-settings';
import {
  arrangeAudiences,
  audienceRequest,
  issueAudienceBrowser,
} from '../audience-authorization.fixtures';

const TARGET_ROLES = {
  customer: 'assignment-customer',
  staff: 'assignment-staff',
} as const;

export interface AssignmentFixture {
  actorId: string;
  adminId: string;
  actor: IssuedBrowserSession;
  targetId: string;
  target: IssuedBrowserSession;
  targetSessionId: string;
  assignedRole: string;
  assignedRoleId: string;
}

export async function provedAssignmentActor(e2e: E2eApp, actorId: string) {
  const issued = await issueAudienceBrowser(e2e, actorId);
  await audienceRequest(e2e, issued, API_PATHS.proof.code, 'post')
    .send({})
    .expect(200);
  await e2e.captureMail();
  const code = await e2e.mailedCode();
  await audienceRequest(e2e, issued, API_PATHS.proof.verifyCode, 'post')
    .send({ code })
    .expect(200);
  return issued;
}

export async function assignmentFixture(
  e2e: E2eApp,
  options: { permissions: string[]; targetAudience?: RoleAudience },
): Promise<AssignmentFixture> {
  const base = await arrangeAudiences(e2e, options.permissions);
  setConfigValue(e2e.app.get(ConfigService), 'admin.strictMutations', true);
  const audience = options.targetAudience ?? ROLE_AUDIENCE.CUSTOMER;
  const assignedRole = TARGET_ROLES[audience];
  const role = await e2e.app.get(UnitOfWorkRunner).run((work) =>
    e2e.app.get(RoleChangeStore).insertCustomRole(work, {
      name: assignedRole,
      slug: assignedRole,
      audience,
      level: 1,
      permissions: [PROFILE_PERMISSIONS.READ_OWN],
    }),
  );
  const targetId =
    audience === ROLE_AUDIENCE.CUSTOMER ? base.customerId : base.staffId;
  const target = await issueAudienceBrowser(
    e2e,
    targetId,
    audience === ROLE_AUDIENCE.CUSTOMER ? WEB_CLIENT_ID : ADMIN_CLIENT_ID,
  );
  const targetSession = await e2e.app
    .get(Sessions)
    .getSessionByToken(target.sessionToken);
  if (!targetSession) throw new Error('Target session was not persisted');
  return {
    actorId: base.actorId,
    adminId: base.adminId,
    actor: await provedAssignmentActor(e2e, base.actorId),
    targetId,
    target,
    targetSessionId: targetSession.id,
    assignedRole,
    assignedRoleId: role.id,
  };
}

export async function assignmentAuthority(e2e: E2eApp, targetId: string) {
  const stored = await e2e.app.get(AdminAccountStore).findAccount(targetId);
  if (!stored) throw new Error('Assignment target was not persisted');
  return {
    role: stored.role,
    version: stored.version,
    sessionVersion: stored.sessionVersion,
  };
}

export function assignFixtureRole(
  e2e: E2eApp,
  fixture: AssignmentFixture,
  actor = fixture.actor,
) {
  return audienceRequest(
    e2e,
    actor,
    API_PATHS.admin.accountRole(fixture.targetId),
    'patch',
  ).send({ role: fixture.assignedRole, version: 1 });
}

export async function expectAssignmentSession(
  e2e: E2eApp,
  fixture: AssignmentFixture,
  live: boolean,
): Promise<void> {
  expect(
    await e2e.state.sessions.session(fixture.targetSessionId),
  ).toMatchObject({
    isValid: true,
  });
  const validated = await e2e.app
    .get(Sessions)
    .validateSessionWithoutExtendingIdle(fixture.target.sessionToken);
  if (live) expect(validated).toMatchObject({ userId: fixture.targetId });
  else expect(validated).toBeNull();
  const events = await e2e.app
    .get(SecurityEventStore)
    .listRecentForUser(fixture.targetId, 10);
  const revocations = events.filter(
    (event) => event.action === SECURITY_EVENT_ACTION.SESSIONS_REVOKED_ALL,
  );
  expect(revocations).toHaveLength(live ? 0 : 1);
}

export async function assignmentRole(e2e: E2eApp, slug: string) {
  const role = await e2e.app
    .get(UnitOfWorkRunner)
    .run((work) => e2e.app.get(RoleChangeStore).readRoleBySlug(work, slug));
  if (!role) throw new Error('Assignment role was not persisted');
  return role;
}

import { Sessions } from '../../src/auth/services/sessions/sessions';
import { invitationEnrolmentCases } from './invitation-enrolment-cases.harness-spec'; // feature:passkeys
import { AdminUserCreateService } from '../../src/admin/services/users/admin-user-create.service';
import { ADMIN_CLIENT_ID } from '../../src/session/constants/client-ids';
import { PasswordSignInStore } from '../../src/auth/stores/password-sign-in.store';
import { HashService } from '../../src/common/services/hash.service';
import { staffPasskeyResetCases } from './staff-passkey-reset-cases.harness-spec'; // feature:passkeys
import { ConfigService } from '@nestjs/config';
import { InvitationStore } from '../../src/auth/invitations/stores/invitation.store';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import type { ApiBody } from '../types/e2e-responses';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
  audienceRequest,
  issueAudienceBrowser,
  STAFF_TARGET_ROLE,
} from '../utils/audience-authorization.fixtures';
import type { AudienceFixture } from '../utils/audience-authorization.fixtures';
import {
  INVITATION_ROUTE,
  proveStaffAct,
} from './staff-invitation-fixtures.harness-spec';

interface InvitationReply {
  id: string;
  email: string;
  role: string;
}

describe('staff invitations', () => {
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
  });

  // Failure: a recent administrator sign-in substitutes for the required explicit act.
  it('refuses an administrator invitation without a fresh act', async () => {
    const session = await issueAudienceBrowser(e2e, fixture.adminId);
    const before = (await e2e.captureMail()).length;
    const response = await audienceRequest(
      e2e,
      session,
      INVITATION_ROUTE,
      'post',
    )
      .set('Idempotency-Key', 'admin-without-act')
      .send({ email: 'new-admin@example.test', role: 'admin' })
      .expect(401);
    expect(response.body).toMatchObject({
      error: { code: ErrorCode.REAUTH_REQUIRED },
    });
    const stored = await e2e.app
      .get(InvitationStore)
      .list({ page: 1, limit: 20, now: e2e.clock.now() });
    expect(stored.total).toBe(0);
    expect((await e2e.captureMail()).length).toBe(before);
  });

  // Failure: wildcard permissions and a valid proof let a non-administrator create an administrator.
  it('refuses a non-administrator with wildcard permissions and a fresh act', async () => {
    const session = await issueAudienceBrowser(e2e, fixture.actorId);
    await proveStaffAct(e2e, session);
    const before = (await e2e.captureMail()).length;
    await audienceRequest(e2e, session, INVITATION_ROUTE, 'post')
      .set('Idempotency-Key', 'non-admin-with-act')
      .send({ email: 'new-admin@example.test', role: 'admin' })
      .expect(403);
    const stored = await e2e.app
      .get(InvitationStore)
      .list({ page: 1, limit: 20, now: e2e.clock.now() });
    expect(stored.total).toBe(0);
    expect((await e2e.captureMail()).length).toBe(before);
  });

  // Failure: a create retry sends twice, creates a second invitation, or changes the body under its key.
  it('replays one invitation without another mail and refuses a different body', async () => {
    const session = await issueAudienceBrowser(e2e, fixture.actorId);
    const before = (await e2e.captureMail()).length;
    const body = {
      email: 'new-staff@example.test',
      role: STAFF_TARGET_ROLE,
      name: 'New Staff',
    };
    const create = () =>
      audienceRequest(e2e, session, INVITATION_ROUTE, 'post').set(
        'Idempotency-Key',
        'staff-replay',
      );
    const first = await create().send(body).expect(201);
    const replay = await create().send(body).expect(201);
    const saved = (first.body as ApiBody<InvitationReply>).data;
    expect((replay.body as ApiBody<InvitationReply>).data.id).toBe(saved.id);
    expect(await e2e.app.get(InvitationStore).findById(saved.id)).toMatchObject(
      { email: body.email, roleSlug: STAFF_TARGET_ROLE },
    );
    const conflict = await create()
      .send({ ...body, email: 'other-staff@example.test' })
      .expect(409);
    expect(conflict.body).toMatchObject({
      error: { code: ErrorCode.CONFLICT },
    });
    expect((await e2e.captureMail()).length).toBe(before + 1);
    expect(
      (
        await e2e.app
          .get(InvitationStore)
          .list({ page: 1, limit: 20, now: e2e.clock.now() })
      ).total,
    ).toBe(1);
    expect(saved).not.toHaveProperty('token');
    expect(saved).not.toHaveProperty('tokenHash');
    await audienceRequest(
      e2e,
      session,
      `${INVITATION_ROUTE}/${saved.id}`,
      'delete',
    ).expect(204);
    const afterRevocation = await create().send(body).expect(201);
    expect((afterRevocation.body as ApiBody<unknown>).data).toMatchObject({
      id: saved.id,
      status: 'pending',
      email: 'new-staff@example.test',
    });
    expect((await e2e.captureMail()).length).toBe(before + 1);
  });

  // Failure: keyed account creation follows a later password/edit instead of the original committed result.
  it('replays an account after password changes and deletion with only the original password', async () => {
    const session = await issueAudienceBrowser(e2e, fixture.adminId);
    const body = {
      email: 'keyed-account@example.test',
      name: 'Original account',
      role: STAFF_TARGET_ROLE,
      password: 'Original123!',
    };
    const create = () =>
      audienceRequest(e2e, session, '/api/admin/users', 'post').set(
        'Idempotency-Key',
        'immutable-account',
      );
    const first = await create().send(body).expect(201);
    const saved = (first.body as ApiBody<{ id: string }>).data;
    const validated = await e2e.app
      .get(Sessions)
      .validateSessionWithoutExtendingIdle(session.sessionToken);
    if (!validated) throw new Error('Missing acting session');
    const passwords = e2e.app.get(PasswordSignInStore);
    const candidate = await passwords.findForPasswordCheck(body.email);
    if (!candidate) throw new Error('Missing created account');
    await passwords.storeNewPassword(
      candidate.account,
      await e2e.app.get(HashService).hash('Changed123!'),
    );
    await e2e.state.records.changeAccountRole(saved.id, 'user');
    await e2e.state.records.markAccountDeleted(saved.id);
    const replay = await create().send(body).expect(201);
    expect((replay.body as ApiBody<unknown>).data).toMatchObject({
      id: saved.id,
      name: 'Original account',
      role: STAFF_TARGET_ROLE,
      isDeleted: false,
      version: 0,
    });
    await create()
      .send({ ...body, password: 'Changed123!' })
      .expect(409);
    await e2e.state.records.replaceAccountPermissions(fixture.adminId, []);
    await e2e.state.records.changeAccountRole(fixture.adminId, 'user');
    await create().send(body).expect(403);
    await expect(
      e2e.app
        .get(AdminUserCreateService)
        .createUser(body, 'admin', fixture.adminId, ['*'], {
          key: 'immutable-account',
          session: {
            sessionId: validated.id,
            userId: fixture.adminId,
            clientId: ADMIN_CLIENT_ID,
            signedInAt: TEST_NOW,
          },
        }),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE });
  });

  // Failure: the keyed role answer changes or disappears after a later edit or deletion.
  it('returns the original role answer after its resource is edited and deleted', async () => {
    const session = await issueAudienceBrowser(e2e, fixture.adminId);
    const body = {
      name: 'Replay role',
      description: 'Original role',
      permissions: ['profile:read:own'],
      level: 1,
      audience: 'staff',
    };
    const create = () =>
      audienceRequest(e2e, session, '/api/roles', 'post').set(
        'Idempotency-Key',
        'immutable-role',
      );
    const first = await create().send(body).expect(201);
    const saved = (first.body as ApiBody<{ id: string }>).data;
    await audienceRequest(e2e, session, `/api/roles/${saved.id}`, 'patch')
      .send({ description: 'Changed role' })
      .expect(200);
    await audienceRequest(
      e2e,
      session,
      `/api/roles/${saved.id}`,
      'delete',
    ).expect(204);
    const replay = await create().send(body).expect(201);
    expect((replay.body as ApiBody<unknown>).data).toMatchObject({
      id: saved.id,
      name: 'Replay role',
      description: 'Original role',
      audience: 'staff',
      version: 0,
    });
    await create()
      .send({ ...body, description: 'Changed role' })
      .expect(409);
  });
  staffPasskeyResetCases(() => ({ e2e, adminId: fixture.adminId })); // feature:passkeys
  invitationEnrolmentCases(() => ({ e2e, adminId: fixture.adminId })); // feature:passkeys
});

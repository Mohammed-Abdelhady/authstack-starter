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
  });
  staffPasskeyResetCases(() => ({ e2e, adminId: fixture.adminId })); // feature:passkeys
});

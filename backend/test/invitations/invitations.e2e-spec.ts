import { InvitationAcceptService } from '../../src/auth/invitations/services/invitation-accept.service';
import { InvitationStore } from '../../src/auth/invitations/stores/invitation.store';
import type { InvitationAcceptance } from '../../src/auth/invitations/types/invitation-acceptance';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { RoleChangeStore } from '../../src/role/stores/role-change.store';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { SEED_ADMIN } from '../constants/seed-users';
import type { ApiBody, UserResponse } from '../types/e2e-responses';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { holdBefore, RaceGate } from '../utils/race-gate';
import {
  accept,
  ACCEPT_ROUTE,
  expectUnspent,
  INVITEE_EMAIL,
  mailInvitation,
} from './invitation-fixtures.harness-spec';
import { invitationEnrolmentCases } from './invitation-enrolment-cases.harness-spec';

interface Refusal {
  error: { code: string; message: string };
}

describe('invitation acceptance on the configured database', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  // Acceptance must persist the invited role and establish a usable session without a password.
  it('creates the invited account and signs it in', async () => {
    const { token, invitation } = await mailInvitation(e2e, {
      name: 'Invited person',
    });
    expect(await e2e.state.accounts.accountIdFor(INVITEE_EMAIL)).toBeNull();
    const { response, browser } = await accept(e2e, token);
    expect(response.status).toBe(200);
    const data = response.body as InvitationAcceptance;
    expect({
      purpose: data.purpose,
      enrolment: data.enrolment,
      email: data.user.email,
      name: data.user.name,
      role: data.user.role,
    }).toEqual({
      purpose: 'account',
      enrolment: false,
      email: INVITEE_EMAIL,
      name: 'Invited person',
      role: 'support',
    });
    expect(typeof response.headers[CSRF_HEADER]).toBe('string');
    const stored = await e2e.state.accounts.accountWithAddress(INVITEE_EMAIL);
    expect(stored).toMatchObject({
      _id: data.user.id,
      role: 'support',
      isVerified: true,
      locale: 'en',
    });
    expect(stored?.password).toBeUndefined();
    const profile = await browser.get('/api/user/profile').expect(200);
    expect((profile.body as ApiBody<UserResponse>).data.id).toBe(data.user.id);
    expect(
      (await e2e.app.get(InvitationStore).findById(invitation.id))?.acceptedAt,
    ).toEqual(TEST_NOW);
    expect(await e2e.state.auth.countAddressClaims(INVITEE_EMAIL)).toBe(0);
  });

  // A spent link must neither create another account nor reveal its previous use.
  it('refuses replay exactly like an unknown token', async () => {
    const { token } = await mailInvitation(e2e);
    expect((await accept(e2e, token)).response.status).toBe(200);
    const replay = (await accept(e2e, token)).response;
    const unknown = (await accept(e2e, 'unknown-token')).response;
    expect(replay.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect((replay.body as Refusal).error).toEqual(
      (unknown.body as Refusal).error,
    );
    expect((replay.body as Refusal).error.code).toBe(
      ErrorCode.INVITATION_INVALID,
    );
    expect(await e2e.state.auth.countAccountsWithAddress(INVITEE_EMAIL)).toBe(
      1,
    );
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });

  // Authority withdrawn after issue must prevent privilege creation at acceptance.
  it('refuses an invitation after its inviter is demoted', async () => {
    const { token, invitation } = await mailInvitation(e2e);
    const inviter = await e2e.state.accounts.accountIdFor(SEED_ADMIN.email);
    if (!inviter) throw new Error('Inviter missing');
    await e2e.state.records.changeAccountRole(inviter, 'user');
    await e2e.state.records.replaceAccountPermissions(inviter, []);
    const refused = (await accept(e2e, token)).response;
    expect(refused.status).toBe(400);
    expect((refused.body as Refusal).error.code).toBe(
      ErrorCode.INVITATION_INVALID,
    );
    expect(await e2e.state.accounts.accountIdFor(INVITEE_EMAIL)).toBeNull();
    await expectUnspent(e2e, invitation.id);
  });

  // Deleted roles must not be silently recreated by accepting an old invitation.
  it('refuses a role deleted before acceptance', async () => {
    const roles = e2e.app.get(RoleChangeStore);
    const role = await e2e.app.get(UnitOfWorkRunner).run((work) =>
      roles.insertCustomRole(work, {
        name: 'Invited role',
        slug: 'invited-role',
        audience: 'customer',
        permissions: [],
        level: 1,
      }),
    );
    const { invitation, token } = await mailInvitation(e2e, {
      roleSlug: role.slug,
    });
    await e2e.app
      .get(UnitOfWorkRunner)
      .run((work) => roles.removeRole(work, role.id));
    const refused = (await accept(e2e, token)).response;
    expect(refused.status).toBe(400);
    expect((refused.body as Refusal).error.code).toBe(
      ErrorCode.INVITATION_INVALID,
    );
    expect(await e2e.state.accounts.accountIdFor(INVITEE_EMAIL)).toBeNull();
    await expectUnspent(e2e, invitation.id);
  });

  // Concurrent clicks must spend one token once and leave only one account and session.
  it('serialises simultaneous accepts into one success and one refusal', async () => {
    const { token } = await mailInvitation(e2e);
    const firstBrowser = await browserAgent(e2e.httpServer);
    const secondBrowser = await browserAgent(e2e.httpServer);
    const start = new RaceGate();
    const restore = holdBefore(
      e2e.app.get(InvitationAcceptService),
      'accept',
      (call) => (call < 2 ? start : undefined),
    );
    const attempts = Promise.all(
      [firstBrowser, secondBrowser].map((browser) =>
        browser
          .post(ACCEPT_ROUTE)
          .send({ token })
          .then((response) => response),
      ),
    );
    try {
      await Promise.race([
        start.reached(2),
        attempts.then(() => {
          throw new Error('Requests missed the acceptance gate');
        }),
      ]);
      start.release();
      const responses = await attempts;
      expect(responses.map(({ status }) => status).sort()).toEqual([200, 400]);
      const refused = responses.find(({ status }) => status === 400);
      expect((refused?.body as Refusal).error.code).toBe(
        ErrorCode.INVITATION_INVALID,
      );
      expect(await e2e.state.auth.countAccountsWithAddress(INVITEE_EMAIL)).toBe(
        1,
      );
      expect(await e2e.state.sessions.countSessions()).toBe(1);
    } finally {
      start.release();
      restore();
      await Promise.allSettled([attempts]);
    }
  });

  invitationEnrolmentCases(() => e2e);
});

import { INVITATION_PURPOSE } from '../../src/auth/invitations/constants/invitations';
import { InvitationAcceptService } from '../../src/auth/invitations/services/invitation-accept.service';
import type { InvitationAcceptance } from '../../src/auth/invitations/types/invitation-acceptance';
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
  INVITEE_EMAIL,
  mailInvitation,
} from './invitation-fixtures.harness-spec';

describe('first-administrator invitation', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp(0, { seedUsers: false });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  // Bootstrap must create a verified administrator without requiring a pre-existing inviter.
  it('creates and signs in the first administrator', async () => {
    const { token } = await mailInvitation(e2e, {
      purpose: INVITATION_PURPOSE.FIRST_ADMIN,
      roleSlug: 'admin',
    });
    const { response, browser } = await accept(e2e, token);
    expect(response.status).toBe(200);
    expect(response.body as InvitationAcceptance).toMatchObject({
      purpose: 'first_admin',
      user: { email: INVITEE_EMAIL, role: 'admin', name: 'invitation' },
    });
    expect(
      await e2e.state.accounts.accountWithAddress(INVITEE_EMAIL),
    ).toMatchObject({ role: 'admin', isVerified: true });
    await browser.get('/api/user/profile').expect(200);
  });

  // Distinct bootstrap tokens racing must not both create first administrators.
  it('serialises two first-administrator invitations against the roster', async () => {
    const first = await mailInvitation(e2e, {
      purpose: INVITATION_PURPOSE.FIRST_ADMIN,
      roleSlug: 'admin',
    });
    const secondEmail = 'second-admin@example.test';
    const second = await mailInvitation(e2e, {
      purpose: INVITATION_PURPOSE.FIRST_ADMIN,
      roleSlug: 'admin',
      email: secondEmail,
    });
    const firstBrowser = await browserAgent(e2e.httpServer);
    const secondBrowser = await browserAgent(e2e.httpServer);
    const start = new RaceGate();
    const restore = holdBefore(
      e2e.app.get(InvitationAcceptService),
      'accept',
      (call) => (call < 2 ? start : undefined),
    );
    const attempts = Promise.all([
      firstBrowser
        .post(ACCEPT_ROUTE)
        .send({ token: first.token })
        .then((response) => response),
      secondBrowser
        .post(ACCEPT_ROUTE)
        .send({ token: second.token })
        .then((response) => response),
    ]);
    try {
      await Promise.race([
        start.reached(2),
        attempts.then(() => {
          throw new Error('Requests missed bootstrap gate');
        }),
      ]);
      start.release();
      expect((await attempts).map(({ status }) => status).sort()).toEqual([
        200, 400,
      ]);
      const count =
        (await e2e.state.auth.countAccountsWithAddress(INVITEE_EMAIL)) +
        (await e2e.state.auth.countAccountsWithAddress(secondEmail));
      expect(count).toBe(1);
      expect(await e2e.state.sessions.countSessions()).toBe(1);
    } finally {
      start.release();
      restore();
      await Promise.allSettled([attempts]);
    }
  });
});

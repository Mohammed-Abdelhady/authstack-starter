import { INVITATION_PURPOSE } from '../../src/auth/invitations/constants/invitations';
import { InvitationIssuer } from '../../src/auth/invitations/services/invitation-issuer';
import { InvitationStore } from '../../src/auth/invitations/stores/invitation.store';
import type { InvitationAcceptance } from '../../src/auth/invitations/types/invitation-acceptance';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { CREDENTIAL_PURPOSE } from '../../src/session/constants/credential-purpose';
import { SessionAuthorityStore } from '../../src/session/authority/session-authority.store';
import { ENROLMENT_LIFETIME_MS } from '../../src/session/constants/enrolment';
import { SEED_USER } from '../constants/seed-users';
import type { ApiBody } from '../types/e2e-responses';
import type { E2eApp } from '../utils/e2e-app';
import {
  accept,
  expectUnspent,
  INVITEE_EMAIL,
  mailInvitation,
} from './invitation-fixtures.harness-spec';

interface Refusal {
  error: { code: string; message: string };
}

export function invitationEnrolmentCases(current: () => E2eApp): void {
  // A reset link must grant only a short enrolment session for the existing account.
  it('opens a 15-minute enrolment session without creating an account', async () => {
    const e2e = current();
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('Enrolment account missing');
    const { token } = await mailInvitation(e2e, {
      purpose: INVITATION_PURPOSE.ENROLMENT,
      userId,
      email: SEED_USER.email,
    });
    const { response, browser } = await accept(e2e, token);
    expect(response.status).toBe(200);
    expect(response.body as InvitationAcceptance).toMatchObject({
      purpose: 'enrolment',
      enrolment: true,
      user: { id: userId },
    });
    const sessionId = await e2e.state.sessions.sessionIdWithPurpose(
      CREDENTIAL_PURPOSE.ENROLMENT,
    );
    if (!sessionId) throw new Error('Enrolment session missing');
    const session = await e2e.app
      .get(SessionAuthorityStore)
      .findSessionById(sessionId);
    expect(session?.credentialPurpose).toBe(CREDENTIAL_PURPOSE.ENROLMENT);
    expect(session?.expiresAt).toEqual(
      new Date(e2e.clock.now().getTime() + ENROLMENT_LIFETIME_MS),
    );
    expect(await e2e.state.auth.countAccountsWithAddress(SEED_USER.email)).toBe(
      1,
    );
    await browser.get('/api/user/profile').expect(403);
    const identity = await browser.get('/api/auth/identity').expect(200);
    expect(
      (identity.body as ApiBody<{ enrolment?: boolean }>).data.enrolment,
    ).toBe(true);
    e2e.clock.advance(ENROLMENT_LIFETIME_MS);
    const ended = await browser.get('/api/auth/identity').expect(200);
    expect(
      (ended.body as ApiBody<{ authenticated: boolean }>).data.authenticated,
    ).toBe(false);
  });

  // A deactivated account must not be recoverable through a previously issued reset link.
  it('refuses enrolment for an inactive account and spends nothing', async () => {
    const e2e = current();
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('Enrolment account missing');
    const { token, invitation } = await mailInvitation(e2e, {
      purpose: INVITATION_PURPOSE.ENROLMENT,
      userId,
      email: SEED_USER.email,
    });
    await e2e.state.records.markAccountDeleted(userId);
    const response = (await accept(e2e, token)).response;
    expect(response.status).toBe(400);
    expect((response.body as Refusal).error.code).toBe(
      ErrorCode.INVITATION_INVALID,
    );
    await expectUnspent(e2e, invitation.id);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  // An outstanding first-administrator invite must not bypass a newly created administrator.
  it('refuses first-administrator acceptance when an administrator already exists', async () => {
    const e2e = current();
    const { token, invitation } = await mailInvitation(e2e, {
      purpose: INVITATION_PURPOSE.FIRST_ADMIN,
      roleSlug: 'admin',
    });
    const response = (await accept(e2e, token)).response;
    expect(response.status).toBe(400);
    expect((response.body as Refusal).error.code).toBe(
      ErrorCode.INVITATION_INVALID,
    );
    expect(await e2e.state.accounts.accountIdFor(INVITEE_EMAIL)).toBeNull();
    await expectUnspent(e2e, invitation.id);
  });

  // Revoked and expired links must share the unknown-token refusal and leave no account or session.
  it.each(['revoked', 'expired'] as const)(
    'uniformly refuses a %s invitation',
    async (state) => {
      const e2e = current();
      const { token, invitation } = await mailInvitation(e2e);
      if (state === 'revoked')
        await e2e.app
          .get(UnitOfWorkRunner)
          .run((work) =>
            e2e.app
              .get(InvitationIssuer)
              .revoke(work, invitation, e2e.clock.now()),
          );
      else e2e.clock.set(invitation.expiresAt);
      const response = (await accept(e2e, token)).response;
      const unknown = (await accept(e2e, 'unknown-token')).response;
      expect(response.status).toBe(400);
      expect((response.body as Refusal).error).toEqual(
        (unknown.body as Refusal).error,
      );
      expect(await e2e.state.accounts.accountIdFor(INVITEE_EMAIL)).toBeNull();
      expect(
        (await e2e.app.get(InvitationStore).findById(invitation.id))
          ?.acceptedAt,
      ).toBeUndefined();
      expect(await e2e.state.sessions.countSessions()).toBe(0);
    },
  );
}

import {
  INVITATION_DAY_MS,
  INVITATION_PURPOSE,
} from '../../src/auth/invitations/constants/invitations';
import { InvitationIssuer } from '../../src/auth/invitations/services/invitation-issuer';
import { InvitationMailer } from '../../src/auth/invitations/services/invitation-mailer';
import { InvitationStore } from '../../src/auth/invitations/stores/invitation.store';
import type {
  InvitationPurpose,
  StoredInvitation,
} from '../../src/auth/invitations/types/invitation';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { RoleChangeStore } from '../../src/role/stores/role-change.store';
import { SEED_ADMIN } from '../constants/seed-users';
import type { Response } from 'supertest';
import { browserAgent, type E2eApp, type TestAgent } from '../utils/e2e-app';

export const ACCEPT_ROUTE = '/api/auth/invitations/accept';
export const INVITEE_EMAIL = 'invitation@example.test';

interface InvitationFixtureOptions {
  purpose?: InvitationPurpose;
  roleSlug?: string;
  email?: string;
  name?: string;
  userId?: string;
  clientId?: string;
}

export async function mailInvitation(
  e2e: E2eApp,
  options: InvitationFixtureOptions = {},
): Promise<{ invitation: StoredInvitation; token: string }> {
  const purpose = options.purpose ?? INVITATION_PURPOSE.ACCOUNT;
  const inviterId =
    purpose === INVITATION_PURPOSE.ACCOUNT
      ? await e2e.state.accounts.accountIdFor(SEED_ADMIN.email)
      : undefined;
  if (purpose === INVITATION_PURPOSE.ACCOUNT && !inviterId)
    throw new Error('Inviter seed is missing');
  const issued = await e2e.app.get(UnitOfWorkRunner).run(async (work) => {
    const role =
      purpose === INVITATION_PURPOSE.ENROLMENT
        ? undefined
        : await e2e.app
            .get(RoleChangeStore)
            .readRoleBySlug(work, options.roleSlug ?? 'support');
    if (purpose !== INVITATION_PURPOSE.ENROLMENT && !role)
      throw new Error('Invited role is missing');
    const account = options.userId
      ? await e2e.app.get(AdminAccountStore).readAccount(work, options.userId)
      : null;
    return e2e.app.get(InvitationIssuer).issue(work, {
      purpose,
      email: options.email ?? INVITEE_EMAIL,
      name: options.name,
      role: role ?? undefined,
      invitedBy: inviterId ?? undefined,
      userId: options.userId,
      addressGeneration: account?.addressGeneration,
      locale: 'en',
      clientId: options.clientId ?? 'web',
      lifetimeMs: INVITATION_DAY_MS,
    });
  });
  const mailer = e2e.app.get(InvitationMailer);
  if (purpose === INVITATION_PURPOSE.ENROLMENT)
    await mailer.sendEnrolmentLink(issued.invitation, issued.token);
  else await mailer.sendInvitation(issued.invitation, issued.token, 'Inviter');
  const mails = await e2e.captureMail();
  const text = mails.at(-1)?.text;
  const rawLink = text
    ?.split(/\s+/u)
    .find((part) => part.startsWith('http') && part.includes('#'));
  if (!rawLink) throw new Error('Invitation mail carried no link');
  const token = new URLSearchParams(new URL(rawLink).hash.slice(1)).get(
    'token',
  );
  if (!token) throw new Error('Invitation mail carried no fragment token');
  return { invitation: issued.invitation, token };
}

export async function accept(
  e2e: E2eApp,
  token: string,
): Promise<{ browser: TestAgent; response: Response }> {
  const browser = await browserAgent(e2e.httpServer);
  const response = await browser.post(ACCEPT_ROUTE).send({ token });
  return { browser, response };
}

export async function expectUnspent(e2e: E2eApp, id: string): Promise<void> {
  const invitation = await e2e.app.get(InvitationStore).findById(id);
  expect(invitation).not.toBeNull();
  expect(invitation?.acceptedAt).toBeUndefined();
}

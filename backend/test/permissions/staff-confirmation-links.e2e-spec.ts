import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { AdminRosterStore } from '../../src/admin/stores/admin-roster.store';
import { PasswordSignInStore } from '../../src/auth/stores/password-sign-in.store';
import { ApplicationPolicyReader } from '../../src/auth/contracts/application-policy';
import { InvitationIssuer } from '../../src/auth/invitations/services/invitation-issuer'; // feature:passkeys
import { InvitationMailer } from '../../src/auth/invitations/services/invitation-mailer'; // feature:passkeys
import { EventRecorder } from '../../src/auth/contracts/event-recorder';
import { AdminRecoverService } from '../../src/cli/admin-recover.service';
import { SEED_ADMIN } from '../constants/seed-users';
import { ConfigService } from '@nestjs/config';
import { AdminEmailChangeService } from '../../src/admin/services/users/admin-email-change.service';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
  audienceRequest,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

let e2e: E2eApp;

async function assertLegacyRecoveryLink(): Promise<void> {
  await arrangeAudiences(e2e);
  const created = await e2e.state.accounts.createAccount({
    email: 'legacy-owner@example.test',
    name: 'Legacy owner',
    role: 'admin',
    isVerified: true,
    pendingEmail: NEW_ADDRESS,
    locale: 'en',
  });
  const stored = await e2e.app.get(AdminAccountStore).findAccount(created._id);
  if (!stored) throw new Error('Legacy owner is missing');
  expect(stored.audience).toBeUndefined();
  await e2e.app
    .get(AdminEmailChangeService)
    .sendServerCommandConfirmation(stored);
  const mail = (await e2e.captureMail()).find(
    (item) => item.to === NEW_ADDRESS,
  );
  expect(
    confirmationLinks(mail?.text).some(
      (link) => link.origin === CUSTOMER_ORIGIN,
    ),
  ).toBe(true);
}

const CUSTOMER_ORIGIN = 'https://customer-links.example.test';
const STAFF_LINK_ORIGIN = 'https://staff-links.example.test';
const NEW_ADDRESS = 'next-confirmation@example.test';

function confirmationLinks(text: string | undefined): URL[] {
  return (text?.match(/https:\/\/[^\s]+/gu) ?? []).map((link) => new URL(link));
}

async function assertStaffRecoveryLink(): Promise<void> {
  const fixture = await arrangeAudiences(e2e);
  const recovery = new AdminRecoverService(
    e2e.app.get(UnitOfWorkRunner),
    e2e.app.get(AdminRosterStore),
    e2e.app.get(PasswordSignInStore),
    e2e.app.get(AdminAccountStore),
    e2e.app.get(ApplicationPolicyReader),
    e2e.app.get(InvitationIssuer), // feature:passkeys
    e2e.app.get(InvitationMailer), // feature:passkeys
    e2e.app.get(AdminEmailChangeService),
    e2e.app.get(EventRecorder),
    e2e.app.get(ConfigService),
  );
  const result = await recovery.recover({
    email: SEED_ADMIN.email,
    newEmail: NEW_ADDRESS,
  });
  expect(result).toMatchObject({
    id: fixture.adminId,
    status: 'email_change',
    email: NEW_ADDRESS,
  });
  const stored = await e2e.app
    .get(AdminAccountStore)
    .findAccount(fixture.adminId);
  expect(stored).toMatchObject({
    audience: 'staff',
    email: SEED_ADMIN.email,
    pendingEmail: NEW_ADDRESS,
  });
  const mail = (await e2e.captureMail()).find(
    (item) => item.to === NEW_ADDRESS,
  );
  expect(
    confirmationLinks(mail?.text).some(
      (link) => link.origin === STAFF_LINK_ORIGIN,
    ),
  ).toBe(true);
}

async function bootConfirmationApp(): Promise<void> {
  e2e = await bootE2eApp(0, {
    beforeStart: (app) => {
      const config = app.get(ConfigService);
      config.set('cors.adminUrl', ADMIN_ORIGIN);
      config.set('mail.links', {
        customer: {
          emailChangeCode: `${CUSTOMER_ORIGIN}/{locale}/confirm`,
          magicLink: `${CUSTOMER_ORIGIN}/sign-in`,
        },
        staff: {
          emailChangeCode: `${STAFF_LINK_ORIGIN}/{locale}/confirm`,
          magicLink: `${STAFF_LINK_ORIGIN}/sign-in`,
        },
      });
    },
  });
}

// Failure: pending staff addresses are rendered with customer link templates.
describe('stored account audience reaches confirmation mail', () => {
  beforeAll(bootConfirmationApp, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it.each([
    { target: 'staffId', origin: STAFF_LINK_ORIGIN },
    { target: 'customerId', origin: CUSTOMER_ORIGIN },
  ] as const)(
    'keeps the persisted $target audience on the initial mail and resend',
    async ({ target, origin }) => {
      const fixture = await arrangeAudiences(e2e);
      const browser = await issueAudienceBrowser(e2e, fixture.adminId);
      const store = e2e.app.get(AdminAccountStore);
      const original = await store.findAccount(fixture[target]);
      if (!original) throw new Error('Confirmation target was not persisted');
      await audienceRequest(
        e2e,
        browser,
        `/api/admin/users/${original.id}`,
        'patch',
      )
        .send({ email: NEW_ADDRESS })
        .expect(200);
      const pending = await store.findAccount(original.id);
      if (!pending) throw new Error('Pending confirmation target disappeared');
      expect(pending).toMatchObject({
        email: original.email,
        pendingEmail: NEW_ADDRESS,
      });
      const firstMail = (await e2e.captureMail()).find(
        (mail) => mail.to === NEW_ADDRESS,
      );
      expect(
        confirmationLinks(firstMail?.text).some(
          (link) => link.origin === origin,
        ),
      ).toBe(true);
      expect(
        (await e2e.captureMail()).some((mail) => mail.to === original.email),
      ).toBe(true);
      const beforeResend = (await e2e.captureMail()).length;
      await e2e.app
        .get(AdminEmailChangeService)
        .resend(pending, 'admin', fixture.adminId);
      const resent = (await e2e.captureMail())
        .slice(beforeResend)
        .find((mail) => mail.to === NEW_ADDRESS);
      expect(
        confirmationLinks(resent?.text).some((link) => link.origin === origin),
      ).toBe(true);
    },
  );

  it(
    'keeps the stored staff audience through the server recovery entrypoint',
    assertStaffRecoveryLink,
  );

  it(
    'keeps legacy recovery confirmation on the customer map when no audience was stored',
    assertLegacyRecoveryLink,
  );
});

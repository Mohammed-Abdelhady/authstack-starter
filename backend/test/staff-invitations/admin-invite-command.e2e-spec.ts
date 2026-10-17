import { AdminRecoverService } from '../../src/cli/admin-recover.service';
import { AdminEmailChangeService } from '../../src/admin/services/users/admin-email-change.service';
import { ApplicationPolicyReader } from '../../src/auth/contracts/application-policy';
import { PasswordSignInStore } from '../../src/auth/stores/password-sign-in.store';
import { EmailChangeConfirmationService } from '../../src/auth/services/registration/email-change-confirmation.service';
import { MailService } from '../../src/mail/mail.service';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { ConfigService } from '@nestjs/config';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { AdminRosterStore } from '../../src/admin/stores/admin-roster.store';
import { EventRecorder } from '../../src/auth/contracts/event-recorder';
import { InvitationIssuer } from '../../src/auth/invitations/services/invitation-issuer';
import { InvitationMailer } from '../../src/auth/invitations/services/invitation-mailer';
import { InvitationStore } from '../../src/auth/invitations/stores/invitation.store';
import { AdminCommandError } from '../../src/cli/admin-command-error';
import { adminInviteArguments } from '../../src/cli/admin-command-arguments';
import { AdminInviteService } from '../../src/cli/admin-invite.service';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { Clock } from '../../src/common/services/clock';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

describe('bootstrap administrator command', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => e2e.reset());

  // Failure: the bootstrap command creates another administrator invitation after an administrator exists.
  it('refuses an existing administrator without creating or mailing an invitation', async () => {
    const service = new AdminInviteService(
      e2e.app.get(UnitOfWorkRunner),
      e2e.app.get(AdminRosterStore),
      e2e.app.get(AdminAccountStore),
      e2e.app.get(InvitationStore),
      e2e.app.get(InvitationIssuer),
      e2e.app.get(InvitationMailer),
      e2e.app.get(EventRecorder),
      e2e.app.get(ConfigService),
      e2e.app.get(Clock),
    );
    const before = (await e2e.captureMail()).length;
    await expect(
      service.invite(
        adminInviteArguments(['--email', 'bootstrap@example.test']),
      ),
    ).rejects.toBeInstanceOf(AdminCommandError);
    expect(
      (
        await e2e.app
          .get(InvitationStore)
          .list({ page: 1, limit: 20, now: e2e.clock.now() })
      ).total,
    ).toBe(0);
    expect((await e2e.captureMail()).length).toBe(before);
  });
  // Failure: a known delivery failure reserves the sole bootstrap address until expiry.
  it('releases a failed bootstrap delivery so the same address can be invited again', async () => {
    const id = await e2e.state.accounts.accountIdFor(SEED_ADMIN.email);
    if (!id) throw new Error('Missing seeded administrator');
    await e2e.state.records.markAccountDeleted(id);
    const service = new AdminInviteService(
      e2e.app.get(UnitOfWorkRunner),
      e2e.app.get(AdminRosterStore),
      e2e.app.get(AdminAccountStore),
      e2e.app.get(InvitationStore),
      e2e.app.get(InvitationIssuer),
      e2e.app.get(InvitationMailer),
      e2e.app.get(EventRecorder),
      e2e.app.get(ConfigService),
      e2e.app.get(Clock),
    );
    const options = { email: 'bootstrap@example.test' };
    const delivery = jest
      .spyOn(e2e.app.get(MailService), 'sendMail')
      .mockRejectedValueOnce(new Error('SMTP unavailable'));
    try {
      await expect(service.invite(options)).rejects.toThrow('SMTP unavailable');
      expect(await e2e.state.auth.countAddressClaims(options.email)).toBe(0);
      await expect(service.invite(options)).resolves.toMatchObject({
        status: 'invited',
        email: options.email,
      });
      expect(await e2e.state.auth.countAddressClaims(options.email)).toBe(1);
    } finally {
      delivery.mockRestore();
    }
  });

  function recovery() {
    return new AdminRecoverService(
      e2e.app.get(UnitOfWorkRunner),
      e2e.app.get(AdminRosterStore),
      e2e.app.get(PasswordSignInStore),
      e2e.app.get(AdminAccountStore),
      e2e.app.get(ApplicationPolicyReader),
      e2e.app.get(InvitationIssuer),
      e2e.app.get(InvitationMailer), // feature:passkeys
      e2e.app.get(AdminEmailChangeService),
      e2e.app.get(EventRecorder),
      e2e.app.get(ConfigService),
    );
  }

  // Failure: the recovery command escalates an ordinary account to staff access.
  it('refuses recovery for a non-administrator without sending mail', async () => {
    const before = (await e2e.captureMail()).length;
    await expect(
      recovery().recover({
        email: SEED_USER.email,
        newEmail: 'ordinary-recovery@example.test',
      }),
    ).rejects.toBeInstanceOf(AdminCommandError);
    expect((await e2e.captureMail()).length).toBe(before);
    expect(
      await e2e.state.accounts.accountWithAddress(SEED_USER.email),
    ).toMatchObject({ role: 'user' });
  });

  // Failure: recovery tells the operator it moved an address but the mailed code cannot finish it.
  it('recovers an administrator through the new mailbox and invalidates the old address', async () => {
    const email = 'recovered-admin@example.test';
    await expect(
      recovery().recover({ email: SEED_ADMIN.email, newEmail: email }),
    ).resolves.toMatchObject({ status: 'email_change', email });
    const mails = await e2e.captureMail();
    expect(mails.map((mail) => mail.to)).toEqual([SEED_ADMIN.email, email]);
    const code = await e2e.mailedCode();
    await e2e.app.get(EmailChangeConfirmationService).confirm({ email, code });
    const lookup = e2e.app.get(PasswordSignInStore);
    expect(await lookup.findActiveByAddress(SEED_ADMIN.email)).toBeNull();
    expect(await lookup.findActiveByAddress(email)).toMatchObject({
      email,
      role: 'admin',
      isVerified: true,
    });
  });
});

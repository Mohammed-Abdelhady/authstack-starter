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
});

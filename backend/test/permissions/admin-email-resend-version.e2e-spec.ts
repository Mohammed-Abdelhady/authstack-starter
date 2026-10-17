import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminEmailChangeService } from '../../src/admin/services/users/admin-email-change.service';
import { AdminUserAccessService } from '../../src/admin/services/users/admin-user-access.service';
import { resendAdminEmailChange } from '../../src/admin/services/users/admin-user-resend';
import { StaffMutationRules } from '../../src/admin/services/staff-mutations/staff-mutation-rules';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { AdminAudienceScopes } from '../../src/admin/services/users/admin-audience-scopes';
import { VerificationCodeService } from '../../src/auth/services/codes/verification-code.service';
import { AuthMailService } from '../../src/auth/services/mail/auth-mail.service';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { AddressLedger } from '../../src/common/persistence/address-ledger';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../src/common/persistence/unit-of-work';
import { Clock } from '../../src/common/services/clock';
import { RoleChangeStore } from '../../src/role/stores/role-change.store';
import { UserRole } from '../../src/user/enums/user-role.enum';
import { SENSITIVE_ACTION_WINDOW_MS } from '../../src/session/constants/session-policy';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
  audienceRequest,
} from '../utils/audience-authorization.fixtures';
import {
  beginStaffChange,
  cancelFixture,
  WANTED_ADDRESS,
} from '../admin-email-cancel/cancel-fixtures.harness-spec';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const NEXT_ADDRESS = 'resend-replacement@example.test';
const AUTHORITY_REFUSALS = {
  demote: ErrorCode.EMAIL_CHANGE_NOT_ALLOWED,
  deactivate: ErrorCode.SESSION_INVALID,
  'promote-target': ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
} as const;
let e2e: E2eApp;
let fixture: Awaited<ReturnType<typeof cancelFixture>>;

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
  fixture = await cancelFixture(e2e);
});

function resendPath(id = fixture.audience.staffId) {
  return `/api/admin/users/${id}/resend-email-change`;
}
async function snapshot(email = WANTED_ADDRESS) {
  return {
    account: await e2e.state.accounts.accountWithId(fixture.audience.staffId),
    challenge: await e2e.state.auth.storedPendingRegistrationFields(email),
    mail: (await e2e.captureMail()).length,
  };
}
async function confirm(email: string, code: string) {
  const browser = await browserAgent(e2e.httpServer);
  return browser.post('/api/auth/confirm-email-change').send({ email, code });
}

// Uses real services and stores; the runner schedules one competing commit before issuance work.
function resendAcross(beforeIssuance: () => Promise<void>) {
  const real = e2e.app.get(UnitOfWorkRunner);
  const runner = new (class extends UnitOfWorkRunner {
    private calls = 0;
    async run<T>(work: (unit: UnitOfWork) => Promise<T>): Promise<T> {
      if (++this.calls === 2) await beforeIssuance();
      return real.run(work);
    }
  })();
  const emailChange = new AdminEmailChangeService(
    e2e.app.get(AdminAccountStore),
    e2e.app.get(VerificationCodeService),
    e2e.app.get(AuthMailService),
    e2e.app.get(ConfigService),
    e2e.app.get(AddressLedger),
    runner,
    e2e.app.get(Clock),
    e2e.app.get(AdminAudienceScopes),
  );
  return (version: number) =>
    resendAdminEmailChange(
      {
        access: e2e.app.get(AdminUserAccessService),
        emailChange,
        policy: e2e.app.get(StaffMutationRules).policy,
        roleChanges: e2e.app.get(RoleChangeStore),
        logger: new Logger('ResendVersionTest'),
      },
      {
        id: fixture.audience.staffId,
        actorId: fixture.audience.adminId,
        actorRole: 'admin',
        actorPermissions: ['*'],
        session: fixture.session,
        version,
      },
    );
}

describe('pending-address resend uses the observed account revision', () => {
  it('passes the real DTO revision through SDK and HTTP and confirms the committed mailed challenge', async () => {
    const { pending } = await beginStaffChange(e2e, fixture);
    const before = await snapshot();
    await fixture.client.admin.accounts.resendEmailChange(pending.id, {
      version: pending.version,
    });
    const after = await snapshot();
    expect(after.account).toEqual(before.account);
    expect(after.mail).toBe(before.mail + 1);
    expect(after.challenge).toMatchObject({
      addressGeneration: 1,
      attempts: 0,
    });
    expect((await fixture.client.admin.accounts.get(pending.id)).version).toBe(
      pending.version,
    );
    await confirm(WANTED_ADDRESS, await e2e.mailedCode()).then((reply) =>
      expect(reply.status).toBe(200),
    );
    expect(await e2e.state.accounts.accountWithId(pending.id)).toMatchObject({
      email: WANTED_ADDRESS,
      addressGeneration: 1,
    });
  });

  it('accepts an actual zero revision and reports the absent pending address without mail', async () => {
    const accounts = e2e.app.get(AdminAccountStore);
    const created = await e2e.app.get(UnitOfWorkRunner).run((work) =>
      accounts.insertAccount(work, {
        email: 'resend-zero@example.test',
        name: 'Zero revision',
        role: 'user',
        audience: 'customer',
        locale: 'en',
      }),
    );
    const observed = await fixture.client.admin.accounts.get(created.id);
    expect(observed.version).toBe(0);
    const before = (await e2e.captureMail()).length;
    await expect(
      fixture.client.admin.accounts.resendEmailChange(created.id, {
        version: observed.version,
      }),
    ).rejects.toMatchObject({ status: 400, code: ErrorCode.EMAIL_SEND_FAILED });
    expect((await e2e.captureMail()).length).toBe(before);
    expect((await fixture.client.admin.accounts.get(created.id)).version).toBe(
      0,
    );
  });

  it('refuses a missing strict revision without rotating or mailing', async () => {
    const { pending } = await beginStaffChange(e2e, fixture);
    const before = await snapshot();
    await expect(
      fixture.client.admin.accounts.resendEmailChange(pending.id),
    ).rejects.toMatchObject({ status: 400 });
    expect(await snapshot()).toEqual(before);
  });

  it.each([null, -1, 0.5, 'not-a-version', 2_147_483_648])(
    'refuses malformed revision %p before rotation',
    async (version) => {
      await beginStaffChange(e2e, fixture);
      const before = await snapshot();
      await audienceRequest(e2e, fixture.issued, resendPath(), 'post')
        .send({ version })
        .expect(400);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(['replace', 'cancel'] as const)(
    'rejects the stale command after %s without changing the successor',
    async (action) => {
      const { pending } = await beginStaffChange(e2e, fixture);
      if (action === 'replace')
        await fixture.client.admin.accounts.update(pending.id, {
          email: NEXT_ADDRESS,
          version: pending.version,
        });
      else
        await fixture.client.admin.accounts.cancelEmailChange(pending.id, {
          version: pending.version,
        });
      const before = await snapshot(
        action === 'replace' ? NEXT_ADDRESS : WANTED_ADDRESS,
      );
      const code = await e2e.mailedCode();
      await expect(
        fixture.client.admin.accounts.resendEmailChange(pending.id, {
          version: pending.version,
        }),
      ).rejects.toMatchObject({ status: 409, code: ErrorCode.CONFLICT });
      expect(
        await snapshot(action === 'replace' ? NEXT_ADDRESS : WANTED_ADDRESS),
      ).toEqual(before);
      if (action === 'replace')
        await confirm(NEXT_ADDRESS, code).then((reply) =>
          expect(reply.status).toBe(200),
        );
    },
  );

  it.each(['replace', 'cancel', 'name-only'] as const)(
    'checks the revision inside issuance after a concurrent %s commit',
    async (action) => {
      const { pending } = await beginStaffChange(e2e, fixture);
      let code = '';
      let before: Awaited<ReturnType<typeof snapshot>> | undefined;
      const address = action === 'replace' ? NEXT_ADDRESS : WANTED_ADDRESS;
      const resend = resendAcross(async () => {
        if (action === 'cancel')
          await fixture.client.admin.accounts.cancelEmailChange(pending.id, {
            version: pending.version,
          });
        else
          await fixture.client.admin.accounts.update(pending.id, {
            ...(action === 'replace'
              ? { email: NEXT_ADDRESS }
              : { name: 'Concurrent rename' }),
            version: pending.version,
          });
        code = await e2e.mailedCode();
        before = await snapshot(address);
      });
      await expect(resend(pending.version)).rejects.toMatchObject({
        status: 409,
        code: ErrorCode.CONFLICT,
      });
      expect(await snapshot(address)).toEqual(before);
      if (action !== 'cancel')
        await confirm(address, code).then((reply) =>
          expect(reply.status).toBe(200),
        );
    },
  );

  it.each(['demote', 'deactivate', 'promote-target'] as const)(
    'rejects authority changed during preparation: %s',
    async (action) => {
      const { pending } = await beginStaffChange(e2e, fixture);
      const before = await snapshot();
      const resend = resendAcross(async () => {
        if (action === 'demote')
          await e2e.state.records.changeAccountRole(
            fixture.audience.adminId,
            UserRole.MANAGER,
          );
        else if (action === 'deactivate')
          await e2e.state.records.markAccountDeleted(fixture.audience.adminId);
        else
          await e2e.state.records.changeAccountRole(pending.id, UserRole.ADMIN);
      });
      await expect(resend(pending.version)).rejects.toMatchObject({
        code: AUTHORITY_REFUSALS[action],
      });
      const after = await snapshot();
      expect(after.challenge).toEqual(before.challenge);
      expect(after.mail).toBe(before.mail);
      expect(after.account?.pendingEmail).toBe(WANTED_ADDRESS);
    },
  );

  it('preserves legacy omission while still rejecting supplied stale revisions', async () => {
    const { pending } = await beginStaffChange(e2e, fixture);
    e2e.app.get(ConfigService).set('admin.strictMutations', false);
    await fixture.client.admin.accounts.resendEmailChange(pending.id);
    const before = await snapshot();
    await expect(
      fixture.client.admin.accounts.resendEmailChange(pending.id, {
        version: pending.version - 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await snapshot()).toEqual(before);
  });

  it('keeps strict stale-proof and self refusals without changing the pending challenge', async () => {
    const { pending } = await beginStaffChange(e2e, fixture);
    const before = await snapshot();
    await expect(
      fixture.client.admin.accounts.resendEmailChange(
        fixture.audience.adminId,
        { version: 0 },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.CANNOT_MODIFY_SELF });
    e2e.clock.advance(SENSITIVE_ACTION_WINDOW_MS + 1);
    await expect(
      fixture.client.admin.accounts.resendEmailChange(pending.id, {
        version: pending.version,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.REAUTH_REQUIRED });
    expect(await snapshot()).toEqual(before);
  });
});

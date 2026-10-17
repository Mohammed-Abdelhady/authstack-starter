import { codeMailedTo } from '../utils/user/accounts-contract/accounts-contract-own-email-support';
import { cancellationRaceCases } from './cancel-races-cases.harness-spec';
import { ConfigService } from '@nestjs/config';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import {
  ADDRESS_CLAIM_KIND,
  AddressLedger,
} from '../../src/common/persistence/address-ledger';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { SENSITIVE_ACTION_WINDOW_MS } from '../../src/session/constants/session-policy';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
  SCOPE_ACTOR_ROLE,
  audienceRequest,
  issueAudienceBrowser,
} from '../utils/audience-authorization.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { staffClient } from '../utils/sdk/staff-browser-client';
import { AdminRosterStore } from '../../src/admin/stores/admin-roster.store';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  beginStaffChange,
  cancelFixture,
  cancellationRequest,
  cancellationWith,
  updateEvents,
  WANTED_ADDRESS,
} from './cancel-fixtures.harness-spec';

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

async function stored() {
  return e2e.state.accounts.accountWithId(fixture.audience.staffId);
}

describe('administrator pending-address cancellation', () => {
  it.each(['staff', 'self'] as const)(
    'clears a %s pending address once without changing primary, mail or sessions',
    async (initiator) => {
      let code: string;
      if (initiator === 'staff')
        ({ code } = await beginStaffChange(e2e, fixture));
      else {
        const target = await issueAudienceBrowser(
          e2e,
          fixture.audience.staffId,
        );
        await audienceRequest(e2e, target, '/api/user/email', 'post')
          .send({ email: WANTED_ADDRESS })
          .expect(200);
        code = codeMailedTo(await e2e.captureMail(), WANTED_ADDRESS);
      }
      const pending = await fixture.client.admin.accounts.get(
        fixture.audience.staffId,
      );
      const before = {
        account: await stored(),
        mail: (await e2e.captureMail()).length,
        sessions: await e2e.state.sessions.countSessions(),
        events: (await updateEvents(e2e, pending.id)).map((event) => event.id),
      };
      const result = await fixture.client.admin.accounts.cancelEmailChange(
        pending.id,
        { version: pending.version },
      );
      expect(result).toMatchObject({
        id: pending.id,
        email: pending.email,
        version: pending.version + 1,
        lastActiveAt: initiator === 'self' ? TEST_NOW.toISOString() : null,
      });
      expect(result).not.toHaveProperty('pendingEmail');
      expect(await stored()).toMatchObject({
        email: pending.email,
        addressGeneration: (before.account?.addressGeneration ?? 0) + 1,
      });
      expect(await e2e.state.auth.countAddressClaims(WANTED_ADDRESS)).toBe(0);
      expect({
        mail: (await e2e.captureMail()).length,
        sessions: await e2e.state.sessions.countSessions(),
      }).toEqual({ mail: before.mail, sessions: before.sessions });
      const events = await updateEvents(e2e, pending.id);
      const added = events.filter((event) => !before.events.includes(event.id));
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        actorId: fixture.audience.adminId,
        targetUserId: pending.id,
        clientId: 'admin',
        details: { changedFields: ['email'] },
      });
      const browser = await browserAgent(e2e.httpServer);
      await browser
        .post('/api/auth/confirm-email-change')
        .send({ email: WANTED_ADDRESS, code })
        .expect(400);
      const target = await issueAudienceBrowser(e2e, pending.id);
      await audienceRequest(e2e, target, '/api/user/email/confirm', 'post')
        .send({ code })
        .expect(400);
      await expect(
        fixture.client.admin.accounts.cancelEmailChange(pending.id, {
          version: pending.version,
        }),
      ).rejects.toMatchObject({ status: 409 });
    },
  );

  it('checks version before a no-op and cannot cancel a newer pending request', async () => {
    const current = await fixture.client.admin.accounts.get(
      fixture.audience.staffId,
    );
    const before = await stored();
    await expect(
      fixture.client.admin.accounts.cancelEmailChange(current.id),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await fixture.client.admin.accounts.cancelEmailChange(current.id, {
        version: current.version,
      }),
    ).toMatchObject({ version: current.version, lastActiveAt: null });
    expect(await stored()).toEqual(before);
    expect(await updateEvents(e2e, current.id)).toEqual([]);
    await beginStaffChange(e2e, fixture);
    await expect(
      fixture.client.admin.accounts.cancelEmailChange(current.id, {
        version: current.version,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await stored())?.pendingEmail).toBe(WANTED_ADDRESS);
  });

  it('refuses stale proof, self, non-admin and a demoted actor without changing pending state', async () => {
    const { pending } = await beginStaffChange(e2e, fixture);
    await expect(
      fixture.client.admin.accounts.cancelEmailChange(
        fixture.audience.adminId,
        { version: 0 },
      ),
    ).rejects.toMatchObject({ code: 'CANNOT_MODIFY_SELF' });
    const other = staffClient(e2e, {
      issued: await issueAudienceBrowser(e2e, fixture.audience.actorId),
    });
    await expect(
      other.admin.accounts.cancelEmailChange(pending.id, {
        version: pending.version,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_CHANGE_NOT_ALLOWED' });
    e2e.clock.advance(SENSITIVE_ACTION_WINDOW_MS + 1);
    await expect(
      fixture.client.admin.accounts.cancelEmailChange(pending.id, {
        version: pending.version,
      }),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    await fixture.client.proof.sendCode();
    await fixture.client.proof.verifyCode({ code: await e2e.mailedCode() });
    const service = cancellationWith(e2e, () =>
      e2e.state.records.changeAccountRole(
        fixture.audience.adminId,
        SCOPE_ACTOR_ROLE,
      ),
    );
    await expect(
      service.cancel(cancellationRequest(fixture, pending.version)),
    ).rejects.toMatchObject({ status: 403 });
    expect((await stored())?.pendingEmail).toBe(WANTED_ADDRESS);
  });

  it('preserves a successor owner claim while invalidating only this account pending generation', async () => {
    const { pending } = await beginStaffChange(e2e, fixture);
    const ledger = e2e.app.get(AddressLedger);
    await e2e.app.get(UnitOfWorkRunner).run(async (work) => {
      await ledger.release(work, {
        address: WANTED_ADDRESS,
        owner: pending.id,
      });
      await ledger.claim(work, {
        address: WANTED_ADDRESS,
        owner: fixture.audience.customerId,
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        now: TEST_NOW,
        lapsesAt: new Date('2099-01-02T12:00:00.000Z'),
      });
    });
    await fixture.client.admin.accounts.cancelEmailChange(pending.id, {
      version: pending.version,
    });
    const live = await e2e.app.get(UnitOfWorkRunner).run((work) =>
      ledger.holdsLiveClaim(work, {
        address: WANTED_ADDRESS,
        owner: fixture.audience.customerId,
        now: TEST_NOW,
      }),
    );
    expect(live).toBe(true);
    expect((await stored())?.pendingEmail).toBeUndefined();
  });
  it('requires an act for a peer and restores a blocked administrator without excluding the target', async () => {
    e2e.app.get(ConfigService).set('admin.strictMutations', false);
    const accounts = e2e.app.get(AdminAccountStore);
    const runner = e2e.app.get(UnitOfWorkRunner);
    const peerAccount = await runner.run((work) =>
      accounts.insertAccount(work, {
        email: 'cancel-peer@example.test',
        name: 'Peer',
        role: 'admin',
        audience: 'staff',
        locale: 'en',
      }),
    );
    const peerId = peerAccount.id;
    const pendingPeer = await runner.run(async (work) => {
      const peer = await accounts.takeAccountForChange(work, peerId);
      if (!peer) throw new Error('The peer is missing');
      return accounts.saveIdentity(work, peer, {
        address: { email: WANTED_ADDRESS, addressGeneration: 1 },
      });
    });
    await expect(
      fixture.client.admin.accounts.cancelEmailChange(peerId, {
        version: pendingPeer.version ?? 0,
      }),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    await fixture.client.proof.sendCode();
    await fixture.client.proof.verifyCode({ code: await e2e.mailedCode() });
    await runner.run(async (work) => {
      const actor = await accounts.takeAccountForChange(
        work,
        fixture.audience.adminId,
      );
      if (!actor) throw new Error('The administrator is missing');
      await accounts.saveIdentity(work, actor, {
        address: { email: 'blocked-actor@example.test', addressGeneration: 1 },
      });
    });
    const count = () =>
      runner.run((work) =>
        e2e.app.get(AdminRosterStore).countAdminsWhoCanSignIn(work, {
          excluding: [],
          passkeyRelyingParty: null,
        }),
      );
    expect(await count()).toBe(0);
    const restored = await fixture.client.admin.accounts.cancelEmailChange(
      peerId,
      { version: pendingPeer.version ?? 0 },
    );
    expect(restored.email).toBe('cancel-peer@example.test');
    expect(restored).not.toHaveProperty('pendingEmail');
    expect(await count()).toBe(1);
  });

  it('rolls back the pending address, owner claim and event when work fails before commit', async () => {
    const { pending } = await beginStaffChange(e2e, fixture);
    const before = {
      account: await stored(),
      events: await updateEvents(e2e, pending.id),
    };
    const failure = new Error('Failure after cancellation and activity read');
    const service = cancellationWith(
      e2e,
      () => Promise.resolve(),
      () => {
        throw failure;
      },
    );
    await expect(
      service.cancel(cancellationRequest(fixture, pending.version)),
    ).rejects.toBe(failure);
    expect(await stored()).toEqual(before.account);
    expect(await e2e.state.auth.countAddressClaims(WANTED_ADDRESS)).toBe(1);
    expect(await updateEvents(e2e, pending.id)).toEqual(before.events);
  });

  it('allows only one of two cancellations prepared from the same version', async () => {
    const { pending } = await beginStaffChange(e2e, fixture);
    const before = (await updateEvents(e2e, pending.id)).length;
    const results = await Promise.allSettled([
      fixture.client.admin.accounts.cancelEmailChange(pending.id, {
        version: pending.version,
      }),
      fixture.client.admin.accounts.cancelEmailChange(pending.id, {
        version: pending.version,
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const refusal = results.find((result) => result.status === 'rejected');
    expect(
      refusal?.status === 'rejected' ? refusal.reason : null,
    ).toMatchObject({ status: 409 });
    expect((await fixture.client.admin.accounts.get(pending.id)).version).toBe(
      pending.version + 1,
    );
    expect((await updateEvents(e2e, pending.id)).length).toBe(before + 1);
  });

  cancellationRaceCases(() => ({ e2e, fixture }));
});

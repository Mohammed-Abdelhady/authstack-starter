import { AdminSignInRule } from '../../../src/admin/stores/admin-roster.store';
import { EMAIL_CHANGE_INITIATOR } from '../../../src/auth/constants/email-change-initiator';
import { RosterHarnessSource } from './admin-roster-harness';

export function rosterCases(current: RosterHarnessSource): void {
  const count = (rule: AdminSignInRule): Promise<number> => {
    const h = current();
    return h.runner().run((uow) => h.roster.countAdminsWhoCanSignIn(uow, rule));
  };

  it('reads the own-email writer as usable while staff and legacy pending changes stay excluded', async () => {
    const h = current();
    const own = await h.seedAccount({
      email: 'own@example.test',
      role: 'admin',
      verified: true,
    });
    await h.seedAccount({
      email: 'staff@example.test',
      role: 'admin',
      verified: true,
      pendingEmail: 'staff-next@example.test',
      pendingEmailInitiator: EMAIL_CHANGE_INITIATOR.STAFF,
    });
    await h.seedAccount({
      email: 'legacy@example.test',
      role: 'admin',
      verified: true,
      pendingEmail: 'legacy-next@example.test',
    });
    await h.runner().run(async (work) => {
      const account = await h.activation.readMovedAccount(work, own);
      if (!account) throw new Error('The roster account was not stored');
      await h.activation.savePendingAddress(work, account, {
        email: 'own-next@example.test',
        addressGeneration: 1,
      });
    });
    const rule = { passkeyRelyingParty: null, excluding: [] };
    expect(await count(rule)).toBe(1);
    expect(await count({ ...rule, excluding: [own] })).toBe(0);
  });

  // Counting an administrator who cannot sign in can allow the last usable one to be removed.
  it('counts only verified active administrators with no pending address', async () => {
    const h = current();
    const rule = { passkeyRelyingParty: null, excluding: [] };
    expect(await count(rule)).toBe(0);
    const eligible = await h.seedAccount({
      email: 'eligible@example.com',
      role: 'admin',
      verified: true,
    });
    await h.seedAccount({ email: 'unverified@example.com', role: 'admin' });
    await h.seedAccount({
      email: 'pending@example.com',
      role: 'admin',
      verified: true,
      pendingEmail: 'next@example.com',
    });
    await h.seedAccount({
      email: 'deleted@example.com',
      role: 'admin',
      verified: true,
      deleted: true,
    });
    await h.seedAccount({ email: 'ordinary@example.com', verified: true });
    expect(await count(rule)).toBe(1);
    expect(await count({ ...rule, excluding: [eligible] })).toBe(0);
  });

  // Bootstrap must not mistake a suspended administrator for an active one.
  it('finds an active administrator regardless of sign-in readiness', async () => {
    const h = current();
    const active = () =>
      h.runner().run((uow) => h.roster.hasActiveAdministrator(uow));
    expect(await active()).toBe(false);
    await h.seedAccount({
      email: 'deleted@example.com',
      role: 'admin',
      deleted: true,
    });
    await h.seedAccount({ email: 'ordinary@example.com', verified: true });
    expect(await active()).toBe(false);
    await h.seedAccount({ email: 'unverified@example.com', role: 'admin' });
    expect(await active()).toBe(true);
  });

  // feature:passkeys:start
  // A credential for another relying party must not justify removing the last usable administrator.
  it('counts each eligible passkey holder once and applies relying-party exclusions', async () => {
    const h = current();
    const marked = await h.seedAccount({
      email: 'marked@example.com',
      role: 'admin',
      pendingEmail: 'next@example.com',
    });
    const unmarked = await h.seedAccount({
      email: 'unmarked@example.com',
      role: 'admin',
    });
    const other = await h.seedAccount({
      email: 'other-rp@example.com',
      role: 'admin',
    });
    const deleted = await h.seedAccount({
      email: 'deleted@example.com',
      role: 'admin',
      deleted: true,
    });
    const ordinary = await h.seedAccount({ email: 'ordinary@example.com' });
    await h.seedAccount({
      email: 'missing@example.com',
      role: 'admin',
      verified: true,
    });
    await h.seedPasskey(marked, 'staff.example.com');
    await h.seedPasskey(marked, 'staff.example.com');
    await h.seedPasskey(unmarked);
    await h.seedPasskey(other, 'customer.example.com');
    await h.seedPasskey(deleted, 'staff.example.com');
    await h.seedPasskey(ordinary, 'staff.example.com');
    const rule = {
      passkeyRelyingParty: {
        rpId: 'staff.example.com',
        includesUnmarked: false,
      },
      excluding: [],
    };
    expect(await count(rule)).toBe(1);
    expect(await count({ ...rule, excluding: [marked] })).toBe(0);
    const legacyRule = {
      ...rule,
      passkeyRelyingParty: {
        ...rule.passkeyRelyingParty,
        includesUnmarked: true,
      },
    };
    expect(await count(legacyRule)).toBe(2);
    expect(await count({ ...legacyRule, excluding: [unmarked] })).toBe(1);
    expect(await count({ ...legacyRule, excluding: [marked, unmarked] })).toBe(
      0,
    );
  });
  // feature:passkeys:end
}

import { ROLE_AUDIENCE } from '../../../../src/host/types/host-role.type';
import { holdBefore, RaceGate } from '../../race-gate';
import { AccountsContractHarness } from './accounts-contract-harness';
import {
  AccountsFixture,
  AccountsHarnessSource,
  ADMIN_SLUG,
  configurationForAccounts,
  refusalOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const CUSTOMER_ROLE = 'audience-customer';
const STAFF_ROLE = 'audience-staff';
const NEW_CUSTOMER_ROLE = 'audience-new-customer';
const STAFF_PERMISSION = 'users:read:staff';
const WILDCARD = '*';
const ACTIVE = () =>
  configurationForAccounts({
    web: { signIn: { audience: ROLE_AUDIENCE.CUSTOMER } },
  });

async function mappedAccounts(
  harness: AccountsContractHarness,
  fixture: AccountsFixture,
) {
  await harness.alterRoleAudience(ADMIN_SLUG, ROLE_AUDIENCE.STAFF);
  await harness.alterAccount(fixture.adminId, {
    audience: ROLE_AUDIENCE.STAFF,
  });
  await harness.seedRole({
    name: 'Audience Customer',
    slug: CUSTOMER_ROLE,
    level: 1,
    permissions: [],
    audience: ROLE_AUDIENCE.CUSTOMER,
  });
  await harness.seedRole({
    name: 'Audience Staff',
    slug: STAFF_ROLE,
    level: 1,
    permissions: [],
    audience: ROLE_AUDIENCE.STAFF,
  });
  return {
    customer: await harness.seedAccount({
      email: 'audience-customer@example.test',
      role: CUSTOMER_ROLE,
      audience: ROLE_AUDIENCE.CUSTOMER,
    }),
    staff: await harness.seedAccount({
      email: 'audience-staff@example.test',
      role: STAFF_ROLE,
      audience: ROLE_AUDIENCE.STAFF,
    }),
  };
}

// Catches role assignment crossing either audience, including sign-out writes.
export function accountAudienceCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it.each([
    { target: 'customer', destination: STAFF_ROLE },
    { target: 'staff', destination: CUSTOMER_ROLE },
  ] as const)(
    'refuses $target assignment to $destination without writes',
    async ({ target, destination }) => {
      const h = harness();
      const ids = await mappedAccounts(h, fixture());
      const userId = ids[target];
      const before = await storedAccount(h, userId);
      const session = await h.seedSession(userId);
      const events = await h.events();
      const services = servicesOn(h, undefined, undefined, ACTIVE());
      expect(
        await refusalOf(
          services.adminUsers.updateUserRole(
            userId,
            { role: destination },
            fixture().adminId,
            ADMIN_SLUG,
            [WILDCARD],
          ),
        ),
      ).toEqual({ code: 'INVALID_ROLE_ASSIGNMENT', status: 400 });
      expect(await storedAccount(h, userId)).toEqual(before);
      expect(await h.liveSessionIds(userId)).toEqual([session]);
      expect(await h.events()).toEqual(events);
    },
  );

  // Catches checking only the destination role read before the assignment UOW.
  it('rereads the destination audience before assigning the role', async () => {
    const h = harness();
    const ids = await mappedAccounts(h, fixture());
    await h.seedRole({
      name: 'New Customer',
      slug: NEW_CUSTOMER_ROLE,
      level: 1,
      permissions: [],
      audience: ROLE_AUDIENCE.CUSTOMER,
    });
    const before = await storedAccount(h, ids.customer);
    const gate = new RaceGate();
    const restore = holdBefore(h.admin, 'takeAccountForChange', (call) =>
      call === 0 ? gate : undefined,
    );
    const services = servicesOn(h, undefined, undefined, ACTIVE());
    const refused = refusalOf(
      services.adminUsers.updateUserRole(
        ids.customer,
        { role: NEW_CUSTOMER_ROLE },
        fixture().adminId,
        ADMIN_SLUG,
        [WILDCARD],
      ),
    );
    try {
      await gate.reached(1);
      await h.alterRoleAudience(NEW_CUSTOMER_ROLE, ROLE_AUDIENCE.STAFF);
    } finally {
      gate.release();
      restore();
    }
    expect(await refused).toEqual({
      code: 'INVALID_ROLE_ASSIGNMENT',
      status: 400,
    });
    expect(await storedAccount(h, ids.customer)).toEqual(before);
    expect(await h.events()).toEqual([]);
  });

  // Catches a grant path accepting staff authority on a customer account.
  it.each([STAFF_PERMISSION, WILDCARD])(
    'limits direct %s to staff accounts',
    async (permission) => {
      const h = harness();
      const ids = await mappedAccounts(h, fixture());
      const services = servicesOn(h, undefined, undefined, ACTIVE());
      expect(
        await refusalOf(
          services.adminPermissions.addPermission(
            ids.customer,
            permission,
            fixture().adminId,
            ADMIN_SLUG,
            [WILDCARD],
          ),
        ),
      ).toEqual({ code: 'FORBIDDEN', status: 403 });
      expect((await storedAccount(h, ids.customer)).permissions).toEqual([]);
      await services.adminPermissions.addPermission(
        ids.staff,
        permission,
        fixture().adminId,
        ADMIN_SLUG,
        [WILDCARD],
      );
      expect((await storedAccount(h, ids.staff)).permissions).toEqual([
        permission,
      ]);
    },
  );

  // Catches removing ordinary customer-management or own-account authority.
  it.each(['users:update:all', 'profile:read:own'])(
    'permits direct %s on both audiences',
    async (permission) => {
      const h = harness();
      const ids = await mappedAccounts(h, fixture());
      const services = servicesOn(h, undefined, undefined, ACTIVE());
      for (const id of [ids.customer, ids.staff]) {
        await services.adminPermissions.addPermission(
          id,
          permission,
          fixture().adminId,
          ADMIN_SLUG,
          [WILDCARD],
        );
        expect((await storedAccount(h, id)).permissions).toEqual([permission]);
      }
    },
  );

  // Catches preflight-only checks when the target changes before the grant UOW.
  it('rereads the target audience before granting staff authority', async () => {
    const h = harness();
    const ids = await mappedAccounts(h, fixture());
    const gate = new RaceGate();
    const restore = holdBefore(h.admin, 'takeAccountForChange', (call) =>
      call === 0 ? gate : undefined,
    );
    const services = servicesOn(h, undefined, undefined, ACTIVE());
    const refused = refusalOf(
      services.adminPermissions.addPermission(
        ids.staff,
        STAFF_PERMISSION,
        fixture().adminId,
        ADMIN_SLUG,
        [WILDCARD],
      ),
    );
    try {
      await gate.reached(1);
      await h.alterAccount(ids.staff, { audience: ROLE_AUDIENCE.CUSTOMER });
    } finally {
      gate.release();
      restore();
    }
    expect(await refused).toEqual({ code: 'FORBIDDEN', status: 403 });
    expect((await storedAccount(h, ids.staff)).permissions).toEqual([]);
  });

  // Catches a new restriction leaking into deployments without named audiences.
  it('preserves legacy assignment when no application names an audience', async () => {
    const h = harness();
    const ids = await mappedAccounts(h, fixture());
    await servicesOn(h).adminUsers.updateUserRole(
      ids.customer,
      { role: STAFF_ROLE },
      fixture().adminId,
      ADMIN_SLUG,
      [WILDCARD],
    );
    expect(await storedAccount(h, ids.customer)).toMatchObject({
      role: STAFF_ROLE,
      audience: 'customer',
      sessionVersion: 1,
    });
  });
}

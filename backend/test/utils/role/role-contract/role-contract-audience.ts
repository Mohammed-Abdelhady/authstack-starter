import { ConfigService } from '@nestjs/config';
import { ROLE_AUDIENCE } from '../../../../src/host/types/host-role.type';
import { finishBootstrap } from '../../../../src/role/services/bootstrap/role-bootstrap.harness-spec';
import { rejectionOf } from '../../session/issuance-contract/issuance-contract-support';
import {
  DEFAULT_SLUG,
  EDITOR_SLUG,
  LEAD_SLUG,
  RoleFixture,
  RoleHarnessSource,
  answerOf,
  revocationsOf,
  servicesOn,
} from './role-contract-support';

const ACTIVE = () =>
  new ConfigService({
    auth: { web: { signIn: { audience: ROLE_AUDIENCE.CUSTOMER } } },
  });
const RETIRED_SLUG = 'retired-role';
const RESTRICTED_GRANTS = ['*', 'users:read:staff'];

// Catches repairs moving persisted holders across audience boundaries.
export function roleAudienceRepairCases(
  harness: RoleHarnessSource,
  fixture: () => RoleFixture,
): void {
  it.each([
    {
      accountAudience: ROLE_AUDIENCE.CUSTOMER,
      roleAudience: ROLE_AUDIENCE.STAFF,
    },
    {
      accountAudience: ROLE_AUDIENCE.STAFF,
      roleAudience: ROLE_AUDIENCE.CUSTOMER,
    },
  ])(
    'keeps an incompatible $accountAudience holder repair owed',
    async ({ accountAudience, roleAudience }) => {
      const h = harness();
      await h.alterRoleAudience(EDITOR_SLUG, roleAudience);
      const holder = await h.seedAccount({
        role: EDITOR_SLUG,
        audience: accountAudience,
      });
      await h.interruptRename(fixture().editorRoleId, {
        name: 'Content Lead',
        slug: LEAD_SLUG,
        previousSlug: EDITOR_SLUG,
        actorId: fixture().adminId,
      });
      await finishBootstrap([servicesOn(h, undefined, ACTIVE()).bootstrap()]);
      expect(await h.account(holder)).toEqual({
        role: EDITOR_SLUG,
        sessionVersion: 0,
        audience: accountAudience,
      });
      expect((await h.role(LEAD_SLUG))?.owedRepairs).toEqual([
        `${EDITOR_SLUG} for ${fixture().editorRoleId}`,
      ]);
      expect(await h.events()).toEqual([]);
    },
  );

  // Catches refusing every repair instead of applying the audience predicate.
  it('repairs a compatible staff holder and revokes it once', async () => {
    const h = harness();
    await h.alterRoleAudience(EDITOR_SLUG, ROLE_AUDIENCE.STAFF);
    const holder = await h.seedAccount({
      role: EDITOR_SLUG,
      audience: ROLE_AUDIENCE.STAFF,
    });
    await h.interruptRename(fixture().editorRoleId, {
      name: 'Content Lead',
      slug: LEAD_SLUG,
      previousSlug: EDITOR_SLUG,
      actorId: fixture().adminId,
    });
    await finishBootstrap([servicesOn(h, undefined, ACTIVE()).bootstrap()]);
    await finishBootstrap([servicesOn(h, undefined, ACTIVE()).bootstrap()]);
    expect(await h.account(holder)).toEqual({
      role: LEAD_SLUG,
      sessionVersion: 1,
      audience: 'staff',
    });
    expect((await h.role(LEAD_SLUG))?.owedRepairs).toEqual([]);
    expect(await revocationsOf(h)).toEqual([
      `${holder} by ${fixture().adminId} (admin_forced)`,
    ]);
  });

  // A blocked holder must not prevent compatible accounts from recovering access.
  it('repairs compatible orphans and keeps an incompatible fallback repair owed', async () => {
    const h = harness();
    await h.alterRoleAudience(DEFAULT_SLUG, ROLE_AUDIENCE.CUSTOMER);
    const fallback = await h.role(DEFAULT_SLUG);
    if (!fallback) throw new Error('default role was not seeded');
    const customer = await h.seedAccount({
      role: RETIRED_SLUG,
      audience: ROLE_AUDIENCE.CUSTOMER,
    });
    const staff = await h.seedAccount({
      role: RETIRED_SLUG,
      audience: ROLE_AUDIENCE.STAFF,
    });
    const deletedRoleId = h.absentId();
    await h.oweRepair(fallback.id, {
      roleId: deletedRoleId,
      previousSlug: RETIRED_SLUG,
      actorId: fixture().adminId,
    });
    await finishBootstrap([servicesOn(h, undefined, ACTIVE()).bootstrap()]);
    await finishBootstrap([servicesOn(h, undefined, ACTIVE()).bootstrap()]);
    expect(await Promise.all([h.account(customer), h.account(staff)])).toEqual([
      {
        role: DEFAULT_SLUG,
        sessionVersion: 1,
        audience: ROLE_AUDIENCE.CUSTOMER,
      },
      { role: RETIRED_SLUG, sessionVersion: 0, audience: ROLE_AUDIENCE.STAFF },
    ]);
    expect((await h.role(DEFAULT_SLUG))?.owedRepairs).toEqual([
      `${RETIRED_SLUG} for ${deletedRoleId}`,
    ]);
    expect(await revocationsOf(h)).toEqual([
      `${customer} by ${fixture().adminId} (admin_forced)`,
    ]);
  });

  // Compatible rename repairs commit even when another holder must stay owed.
  it('repairs a matching rename holder while leaving the incompatible holder owed', async () => {
    const h = harness();
    await h.alterRoleAudience(EDITOR_SLUG, ROLE_AUDIENCE.STAFF);
    const compatible = await h.seedAccount({
      role: EDITOR_SLUG,
      audience: ROLE_AUDIENCE.STAFF,
    });
    const incompatible = await h.seedAccount({
      role: EDITOR_SLUG,
      audience: ROLE_AUDIENCE.CUSTOMER,
    });
    await h.interruptRename(fixture().editorRoleId, {
      name: 'Content Lead',
      slug: LEAD_SLUG,
      previousSlug: EDITOR_SLUG,
      actorId: fixture().adminId,
    });
    await finishBootstrap([servicesOn(h, undefined, ACTIVE()).bootstrap()]);
    await finishBootstrap([servicesOn(h, undefined, ACTIVE()).bootstrap()]);
    expect(await h.account(compatible)).toEqual({
      role: LEAD_SLUG,
      sessionVersion: 1,
      audience: ROLE_AUDIENCE.STAFF,
    });
    expect(await h.account(incompatible)).toEqual({
      role: EDITOR_SLUG,
      sessionVersion: 0,
      audience: ROLE_AUDIENCE.CUSTOMER,
    });
    expect((await h.role(LEAD_SLUG))?.owedRepairs).toEqual([
      `${EDITOR_SLUG} for ${fixture().editorRoleId}`,
    ]);
    expect(await revocationsOf(h)).toEqual([
      `${compatible} by ${fixture().adminId} (admin_forced)`,
    ]);
  });

  // Catches audience policy activating merely because rows contain metadata.
  it('preserves legacy repair when no application names an audience', async () => {
    const h = harness();
    await h.alterRoleAudience(EDITOR_SLUG, ROLE_AUDIENCE.STAFF);
    const holder = await h.seedAccount({
      role: EDITOR_SLUG,
      audience: ROLE_AUDIENCE.CUSTOMER,
    });
    await h.interruptRename(fixture().editorRoleId, {
      name: 'Content Lead',
      slug: LEAD_SLUG,
      previousSlug: EDITOR_SLUG,
      actorId: fixture().adminId,
    });
    await finishBootstrap([servicesOn(h).bootstrap()]);
    expect(await h.account(holder)).toEqual({
      role: LEAD_SLUG,
      sessionVersion: 1,
      audience: 'customer',
    });
    expect((await h.role(LEAD_SLUG))?.owedRepairs).toEqual([]);
  });

  // Catches active creation producing an unmapped role that would block startup.
  it('requires an audience before persisting a role while policy is active', async () => {
    const h = harness();
    const roles = servicesOn(h, undefined, ACTIVE()).roles;
    const refused = await rejectionOf(
      roles.create(
        { name: 'Unmapped Active Role', permissions: [] },
        fixture().adminId,
      ),
    );
    expect(answerOf(refused)).toEqual({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(await h.role('unmapped-active-role')).toBeNull();
  });

  // Catches granting staff authority through inherited role permissions.
  it.each(RESTRICTED_GRANTS)(
    'limits role creation and permission edits carrying %s to staff',
    async (permission) => {
      const h = harness();
      const roles = servicesOn(h, undefined, ACTIVE()).roles;
      const customerDto = {
        name: 'Restricted Customer',
        permissions: [permission],
        audience: ROLE_AUDIENCE.CUSTOMER,
      };
      const refusedCreate = await rejectionOf(
        roles.create(customerDto, fixture().adminId),
      );
      expect(answerOf(refusedCreate)).toEqual({
        code: 'FORBIDDEN',
        status: 403,
      });
      expect(await h.role('restricted-customer')).toBeNull();
      const customer = await roles.create(
        { ...customerDto, permissions: [] },
        fixture().adminId,
      );
      const before = await h.role(customer.slug);
      const refusedEdit = await rejectionOf(
        roles.update(
          customer.id,
          { permissions: [permission] },
          fixture().adminId,
        ),
      );
      expect(answerOf(refusedEdit)).toEqual({
        code: 'FORBIDDEN',
        status: 403,
      });
      expect(await h.role(customer.slug)).toEqual(before);
      const staff = await roles.create(
        {
          name: 'Restricted Staff',
          permissions: [permission],
          audience: ROLE_AUDIENCE.STAFF,
        },
        fixture().adminId,
      );
      expect(await h.role(staff.slug)).toMatchObject({
        audience: 'staff',
        permissions: [permission],
      });
      await roles.update(staff.id, { permissions: [] }, fixture().adminId);
      await roles.update(
        staff.id,
        { permissions: [permission] },
        fixture().adminId,
      );
      expect((await h.role(staff.slug))?.permissions).toEqual([permission]);
      expect(await h.events()).toEqual([]);
    },
  );
}

import {
  HostRole,
  ROLE_AUDIENCE,
} from '../../../src/host/types/host-role.type';
import { SeedContractHarness } from './seed-contract-harness';
import { SEEDED_ROLES, servicesOn } from './seed-contract-support';

const [ADMIN_ROLE, MANAGER_ROLE, SUPPORT_ROLE, USER_ROLE] = SEEDED_ROLES;

const EDITOR: HostRole = {
  name: 'Editor',
  slug: 'editor',
  level: 5,
  audience: ROLE_AUDIENCE.STAFF,
  permissions: ['posts:update:all'],
  description: 'Edits posts',
};

/** What the role seed stores for a host product's own role list. */
export function seedHostRoleCases(current: () => SeedContractHarness): void {
  it('seeds only user and admin for an empty host role list', async () => {
    await servicesOn(current()).roles.seed([]);

    expect(await current().storedRoles()).toEqual([ADMIN_ROLE, USER_ROLE]);
  });

  it('seeds a host role at its own level and keeps admin above it', async () => {
    await servicesOn(current()).roles.seed([EDITOR]);

    expect(await current().storedRoles()).toEqual([
      { ...ADMIN_ROLE, level: 6 },
      {
        name: 'Editor',
        slug: 'editor',
        description: 'Edits posts',
        isSystemRole: true,
        isProtected: true,
        level: 5,
        permissions: ['posts:update:all'],
      },
      USER_ROLE,
    ]);
  });

  it('moves the stored admin level up when a reseed adds a host role above 3', async () => {
    const { roles } = servicesOn(current());
    await roles.seed();
    const before = (await current().storedRoles()).find(
      ({ slug }) => slug === 'admin',
    )?.level;

    await roles.seed([EDITOR]);

    expect({ before, after: await current().storedRoles() }).toEqual({
      before: 4,
      after: [
        { ...ADMIN_ROLE, level: 6 },
        {
          name: 'Editor',
          slug: 'editor',
          description: 'Edits posts',
          isSystemRole: true,
          isProtected: true,
          level: 5,
          permissions: ['posts:update:all'],
        },
        MANAGER_ROLE,
        SUPPORT_ROLE,
        USER_ROLE,
      ],
    });
  });

  it('keeps admin above a host role and its holders when a reseed drops the role', async () => {
    const { roles } = servicesOn(current());
    await roles.seed([EDITOR]);
    for (const [email, role] of [
      ['editor@example.test', 'editor'],
      ['admin@example.test', 'admin'],
    ]) {
      await current().plantAccount({
        email,
        name: role,
        role,
        passwordHash: 'not-a-real-hash',
      });
    }

    await roles.seed([]);

    expect({
      levels: (await current().storedRoles()).map(({ slug, level }) => ({
        slug,
        level,
      })),
      holders: (await current().storedAccounts()).map(({ email, role }) => ({
        email,
        role,
      })),
    }).toEqual({
      levels: [
        { slug: 'admin', level: 6 },
        { slug: 'editor', level: 5 },
        { slug: 'user', level: 1 },
      ],
      holders: [
        { email: 'admin@example.test', role: 'admin' },
        { email: 'editor@example.test', role: 'editor' },
      ],
    });
  });

  it('gives an admin role stored without a level the seeded one', async () => {
    await current().plantRole({ ...ADMIN_ROLE, level: null });

    await servicesOn(current()).roles.seed([]);

    expect(
      (await current().storedRoles()).find(({ slug }) => slug === 'admin')
        ?.level,
    ).toBe(4);
  });

  it('puts back only the core permissions for an empty host role list', async () => {
    const { roles } = servicesOn(current());
    await roles.seed();
    for (const slug of ['admin', 'manager', 'support', 'user']) {
      await current().seeds.replaceRolePermissions(slug, []);
    }

    await roles.updateRolePermissions([]);

    expect(await current().storedRoles()).toEqual([
      ADMIN_ROLE,
      { ...MANAGER_ROLE, permissions: [] },
      { ...SUPPORT_ROLE, permissions: [] },
      USER_ROLE,
    ]);
  });
}

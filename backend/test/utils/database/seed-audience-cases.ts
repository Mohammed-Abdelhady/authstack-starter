import { ConfigService } from '@nestjs/config';
import type { SeedContractHarness } from './seed-contract-harness';
import { servicesOn } from './seed-contract-support';

export function seedAudienceCases(current: () => SeedContractHarness): void {
  // Failure: customer-only activation leaves core admin unmapped or maps it as customer.
  it('maps fresh core seeds and their accounts while retaining defined host audiences', async () => {
    const config = new ConfigService({
      bcrypt: { rounds: 4 },
      auth: { web: { signIn: { audience: 'customer' } } },
    });
    await servicesOn(current(), config).seeds.seedAll();
    expect(
      (await current().storedRoles()).map(({ slug, audience }) => ({
        slug,
        audience,
      })),
    ).toEqual([
      { slug: 'admin', audience: 'staff' },
      { slug: 'manager', audience: 'staff' },
      { slug: 'support', audience: 'staff' },
      { slug: 'user', audience: 'customer' },
    ]);
    expect(
      (await current().storedAccounts()).map(({ role, audience }) => ({
        role,
        audience,
      })),
    ).toEqual([
      { role: 'admin', audience: 'staff' },
      { role: 'manager', audience: 'staff' },
      { role: 'support', audience: 'staff' },
      { role: 'user', audience: 'customer' },
    ]);
  });

  // Failure: a fresh host role gives customer accounts inherited staff authority.
  it.each(['*', 'users:read:staff'])(
    'refuses customer host grants %s before seeding any role',
    async (permission) => {
      const config = new ConfigService({
        auth: { web: { signIn: { audience: 'customer' } } },
      });
      await expect(
        servicesOn(current(), config).roles.seed([
          {
            name: 'Customer',
            slug: 'customer',
            level: 2,
            audience: 'customer',
            permissions: [permission],
            description: 'Customer role',
          },
        ]),
      ).rejects.toThrow('HOST_ROLES role customer');
      expect(await current().storedRoles()).toEqual([]);
    },
  );

  // Failure: reseeding silently rewrites a mapped or legacy role's immutable audience.
  it('preserves existing role and account audiences when audience configuration changes', async () => {
    await servicesOn(current()).seeds.seedAll();
    const before = {
      roles: await current().storedRoles(),
      accounts: await current().storedAccounts(),
    };
    const config = new ConfigService({
      auth: { web: { signIn: { audience: 'customer' } } },
    });
    await servicesOn(current(), config).seeds.seedAll();
    expect({
      roles: await current().storedRoles(),
      accounts: await current().storedAccounts(),
    }).toEqual(before);
    expect(
      before.roles.find(({ slug }) => slug === 'admin')?.audience,
    ).toBeUndefined();
  });
}

import { Logger } from '@nestjs/common';
import { seedAudienceCases } from './seed-audience-cases';
import * as bcrypt from 'bcrypt';
import { TEST_NOW } from '../frozen-clock';
import { CLAIM_OWNER, holdAddress } from '../address-claim';
import { SeedContractHarness, StoredSeedRole } from './seed-contract-harness';
import { seedHostRoleCases } from './seed-contract-host-roles';
import {
  accountFacts,
  ADMIN_PASSWORD,
  ROLE_LINE,
  SEEDED_ACCOUNTS,
  SEEDED_ROLES,
  servicesOn,
  USER_PASSWORD,
} from './seed-contract-support';

/**
 * The seed and reset contract. Every database runs these same cases through
 * its own harness, with the real seed services built on its adapter.
 */
export function describeSeedContract(
  database: string,
  boot: () => Promise<SeedContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`seed and reset contract on ${database}`, () => {
    const environment = { ...process.env };
    let harness: SeedContractHarness | undefined;
    let printed: string[] = [];
    const current = (): SeedContractHarness => {
      if (!harness) {
        throw new Error(`the ${database} harness did not start`);
      }
      return harness;
    };

    beforeAll(async () => {
      harness = await boot();
    }, budgets.bootMs);

    afterAll(async () => {
      await harness?.close();
    }, budgets.teardownMs);

    beforeEach(async () => {
      current().clock.set(TEST_NOW);
      await current().reset();
      process.env.NODE_ENV = 'test';
      process.env.SEED_ADMIN_PASSWORD = ADMIN_PASSWORD;
      process.env.SEED_USER_PASSWORD = USER_PASSWORD;
      delete process.env.SEED_PRINT_PASSWORDS;
      printed = [];
      jest.spyOn(console, 'log').mockImplementation((line: unknown) => {
        printed.push(String(line));
      });
    }, budgets.resetMs);

    afterEach(() => {
      jest.restoreAllMocks();
      process.env = { ...environment };
    });

    it('seeds an empty database with the system roles, the seed accounts and the first applications', async () => {
      const summary = await servicesOn(current()).seeds.seedAll();

      const accounts = await current().storedAccounts();
      const hashOf = (email: string): string =>
        accounts.find((account) => account.email === email)?.passwordHash ?? '';
      expect({
        summary,
        roles: await current().storedRoles(),
        accounts: await accountFacts(current()),
        permissions: accounts.map(({ permissions }) => permissions),
        adminPassword: await bcrypt.compare(
          ADMIN_PASSWORD,
          hashOf('admin@seed.local'),
        ),
        userPassword: await bcrypt.compare(
          USER_PASSWORD,
          hashOf('user@seed.local'),
        ),
        applications: await current().storedApplications(),
        roleLines: printed.filter((line) => ROLE_LINE.test(line)),
      }).toEqual({
        summary: { roles: 'seeded', users: 4, total: 4 },
        roles: SEEDED_ROLES,
        accounts: SEEDED_ACCOUNTS.map((account) => ({
          ...account,
          isVerified: true,
          isDeleted: false,
          authProvider: 'email',
        })),
        permissions: SEEDED_ROLES.map(({ permissions }) => permissions),
        adminPassword: true,
        userPassword: true,
        applications: [
          { clientId: 'admin', platform: 'admin', enabled: true },
          { clientId: 'web', platform: 'web', enabled: true },
        ],
        roleLines: [
          'Created default role: User',
          'Created default role: Support',
          'Created default role: Manager',
          'Created default role: Admin',
          'Role seeding completed',
        ],
      });
    });

    // A deployment seed must not take an address held for another account's move.
    it('skips a seed account while its address has a live claim', async () => {
      const h = current();
      const { seeds } = servicesOn(h);
      await holdAddress(h.ledger, h.runner, h.clock, 'admin@seed.local');
      expect(await seeds.seedUsers()).toBe(3);
      expect((await h.storedAccounts()).map(({ email }) => email)).toEqual([
        'manager@seed.local',
        'support@seed.local',
        'user@seed.local',
      ]);
      await h.runner.run((uow) =>
        h.ledger.release(uow, {
          address: 'admin@seed.local',
          owner: CLAIM_OWNER,
        }),
      );
      expect(await seeds.seedUsers()).toBe(1);
    });

    it('changes nothing when it is run a second time', async () => {
      const { seeds } = servicesOn(current());
      await seeds.seedAll();
      const before = {
        roles: await current().storedRoles(),
        accounts: await current().storedAccounts(),
        applications: await current().storedApplications(),
      };
      printed = [];
      // A second run draws new passwords. None of them may be stored.
      process.env.SEED_ADMIN_PASSWORD = 'AnotherAdmin123!';
      process.env.SEED_USER_PASSWORD = 'AnotherUser123!';
      const failures = jest.spyOn(Logger.prototype, 'error');

      const summary = await seeds.seedAll();

      expect({
        summary,
        failuresLogged: failures.mock.calls.length,
        roles: await current().storedRoles(),
        accounts: await current().storedAccounts(),
        applications: await current().storedApplications(),
        roleLines: printed.filter((line) => ROLE_LINE.test(line)),
      }).toEqual({
        summary: { roles: 'seeded', users: 0, total: 0 },
        failuresLogged: 0,
        ...before,
        roleLines: [
          'Role "User" exists, flags refreshed',
          'Role "Support" exists, flags refreshed',
          'Role "Manager" exists, flags refreshed',
          'Role "Admin" exists, flags refreshed',
          'Role seeding completed',
        ],
      });
    });

    it('keeps what an operator changed and takes back only the level and flags of a role', async () => {
      await current().plantRole({
        name: 'Customers',
        slug: 'user',
        description: 'Renamed by an operator',
        isSystemRole: false,
        isProtected: false,
        level: 9,
        permissions: ['reports:read:all'],
      });
      const plantedHash = await bcrypt.hash('OperatorChose1!', 4);
      const plantedId = await current().plantAccount({
        email: 'admin@seed.local',
        name: 'Kept Admin',
        role: 'manager',
        passwordHash: plantedHash,
      });

      const summary = await servicesOn(current()).seeds.seedAll();

      const admin = (await current().storedAccounts()).find(
        ({ email }) => email === 'admin@seed.local',
      );
      expect({
        summary,
        userRole: (await current().storedRoles()).find(
          ({ slug }) => slug === 'user',
        ),
        admin: {
          id: admin?.id,
          name: admin?.name,
          role: admin?.role,
          passwordHash: admin?.passwordHash,
        },
      }).toEqual({
        summary: { roles: 'seeded', users: 3, total: 3 },
        userRole: {
          name: 'Customers',
          slug: 'user',
          description: 'Renamed by an operator',
          isSystemRole: true,
          isProtected: true,
          level: 1,
          permissions: ['reports:read:all'],
        },
        admin: {
          id: plantedId,
          name: 'Kept Admin',
          role: 'manager',
          passwordHash: plantedHash,
        },
      });
    });

    it('puts the default permissions back on the system roles when asked to', async () => {
      const { roles } = servicesOn(current());
      const editors: StoredSeedRole = {
        name: 'Editors',
        slug: 'content-editor',
        description: null,
        isSystemRole: false,
        isProtected: false,
        level: null,
        permissions: ['reports:read:all'],
      };
      await roles.seed();
      await current().plantRole(editors);
      await current().seeds.replaceRolePermissions('support', []);
      await current().seeds.replaceRolePermissions('no-such-role', ['*']);
      const emptied = (await current().storedRoles()).find(
        ({ slug }) => slug === 'support',
      )?.permissions;

      await roles.updateRolePermissions();

      expect({ emptied, roles: await current().storedRoles() }).toEqual({
        emptied: [],
        roles: [SEEDED_ROLES[0], editors, ...SEEDED_ROLES.slice(1)],
      });
    });

    it('resets to the seeds alone and keeps the record of applied migrations', async () => {
      await current().plantMigrationRecord('20990101000001-kept.js');
      const recorded = await current().migrationRecord();
      await current().plantRole({
        name: 'Editors',
        slug: 'content-editor',
        description: null,
        isSystemRole: false,
        isProtected: false,
        level: null,
        permissions: [],
      });
      await current().plantAccount({
        email: 'stranger@example.test',
        name: 'Stranger',
        role: 'content-editor',
        passwordHash: await bcrypt.hash('Stranger123!', 4),
      });

      await servicesOn(current()).seeds.resetDatabase();

      expect({
        roles: (await current().storedRoles()).map(({ slug }) => slug),
        accounts: (await current().storedAccounts()).map(({ email }) => email),
        migrations: await current().migrationRecord(),
        keptAny: recorded.length > 0,
      }).toEqual({
        roles: ['admin', 'manager', 'support', 'user'],
        accounts: SEEDED_ACCOUNTS.map(({ email }) => email),
        migrations: recorded,
        keptAny: true,
      });
    });

    it('refuses to seed or reset outside development and test, and stores nothing', async () => {
      process.env.NODE_ENV = 'production';
      const { seeds } = servicesOn(current());

      const refusals = [
        await seeds.seedAll().catch((error: Error) => error.message),
        await seeds.resetDatabase().catch((error: Error) => error.message),
      ];

      expect({
        refusals,
        roles: await current().storedRoles(),
        accounts: await current().storedAccounts(),
      }).toEqual({
        refusals: [
          'Database seeding is only allowed when NODE_ENV is "development" or "test".',
          'Database reset is only allowed when NODE_ENV is "development" or "test".',
        ],
        roles: [],
        accounts: [],
      });
    });
    it('refuses in the store itself to empty a database outside development and test, and removes nothing', async () => {
      await servicesOn(current()).seeds.seedAll();
      process.env.NODE_ENV = 'production';

      const refusal = await current()
        .seeds.clearApplicationData()
        .then(
          () => 'emptied',
          (error: Error) => error.message,
        );

      expect({
        refusal,
        roles: (await current().storedRoles()).length,
        accounts: (await current().storedAccounts()).length,
      }).toEqual({
        refusal:
          'Database reset is only allowed when NODE_ENV is "development" or "test".',
        roles: 4,
        accounts: 4,
      });
    });

    seedHostRoleCases(current);
    seedAudienceCases(current);
  });
}

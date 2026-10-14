import { TEST_NOW } from '../../frozen-clock';
import { roleAtomicityCases } from './role-contract-atomicity';
import { roleEditCases } from './role-contract-edits';
import { RoleContractHarness } from './role-contract-harness';
import { roleLargeMoveCases } from './role-contract-large-moves';
import { roleLevelCases } from './role-contract-levels';
import { roleRaceCases } from './role-contract-races';
import { roleReadCases } from './role-contract-reads';
import { roleRepairCases } from './role-contract-repairs';
import { roleRuleCases } from './role-contract-rules';
import { roleSeamCases } from './role-contract-seam';
import { RoleFixture, seedRoleFixture } from './role-contract-support';
import { roleSweepStoreCases } from './role-contract-sweeps';

/**
 * The role stores' contract. Every database runs these same cases through its
 * own harness, with the real role services built on its adapters.
 */
export function describeRoleStoresContract(
  database: string,
  boot: () => Promise<RoleContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`role stores contract on ${database}`, () => {
    let harness: RoleContractHarness | undefined;
    let fixture: RoleFixture | undefined;

    const current = (): RoleContractHarness => {
      if (!harness) {
        throw new Error(`the ${database} harness did not start`);
      }
      return harness;
    };
    const seeded = (): RoleFixture => {
      if (!fixture) {
        throw new Error('the role fixture was not seeded');
      }
      return fixture;
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
      fixture = await seedRoleFixture(current());
    }, budgets.resetMs);

    afterEach(() => jest.restoreAllMocks());

    roleRuleCases(current, seeded);
    roleEditCases(current, seeded);
    roleLevelCases(current, seeded);
    roleReadCases(current, seeded);
    roleSeamCases(current, seeded);
    roleAtomicityCases(current, seeded);
    roleRaceCases(current, seeded);
    roleRepairCases(current, seeded);
    roleSweepStoreCases(current, seeded);
    roleLargeMoveCases(current, seeded);
  });
}

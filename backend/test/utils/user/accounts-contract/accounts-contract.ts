import { TEST_NOW } from '../../frozen-clock';
import { accountAbortCases } from './accounts-contract-abort';
import { accountActivationCases } from './accounts-contract-activation';
import { accountAdminCases } from './accounts-contract-admin';
import { accountFreshnessCases } from './accounts-contract-fresh';
import { accountGrantCases } from './accounts-contract-grants';
import { AccountsContractHarness } from './accounts-contract-harness';
import { accountLeavingCases } from './accounts-contract-leaving';
import { accountPasswordCases } from './accounts-contract-password';
import { accountPermissionAgreementCases } from './accounts-contract-permission-agreement';
import { accountProfileCases } from './accounts-contract-profile';
import { accountRaceCases } from './accounts-contract-races';
import { accountRouteIdCases } from './accounts-contract-route-ids';
import { accountSeamCases } from './accounts-contract-seam';
import {
  AccountsFixture,
  seedAccountsFixture,
} from './accounts-contract-support';

/**
 * The account stores' contract. Every database runs these same cases through
 * its own harness, with the real services built on its adapters.
 */
export function describeAccountStoresContract(
  database: string,
  boot: () => Promise<AccountsContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`account stores contract on ${database}`, () => {
    let harness: AccountsContractHarness | undefined;
    let fixture: AccountsFixture | undefined;

    const current = (): AccountsContractHarness => {
      if (!harness) {
        throw new Error(`the ${database} harness did not start`);
      }
      return harness;
    };
    const seeded = (): AccountsFixture => {
      if (!fixture) {
        throw new Error('the accounts fixture was not seeded');
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
      fixture = await seedAccountsFixture(current());
    }, budgets.resetMs);

    afterEach(() => jest.restoreAllMocks());

    accountProfileCases(current, seeded);
    accountLeavingCases(current, seeded);
    accountAdminCases(current, seeded);
    accountGrantCases(current, seeded);
    accountFreshnessCases(current, seeded);
    accountRaceCases(current, seeded);
    accountActivationCases(current, seeded);
    accountSeamCases(current, seeded);
    accountAbortCases(current, seeded);
    accountRouteIdCases(current, seeded);
    accountPasswordCases(current, seeded);
    accountPermissionAgreementCases(current, seeded);
  });
}

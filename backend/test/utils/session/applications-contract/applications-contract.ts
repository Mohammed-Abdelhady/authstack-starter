import { TEST_NOW } from '../../frozen-clock';
import {
  ADMIN_APPLICATION,
  WEB_APPLICATION,
} from '../issuance-contract/issuance-contract-support';
import { applicationAccessCases } from './applications-access-cases';
import { applicationAtomicityCases } from './applications-atomicity-cases';
import { applicationClientReadCases } from './applications-client-read-cases';
import { ApplicationsContractHarness } from './applications-contract-harness';
import { applicationRaceCases } from './applications-race-cases';
import { reconciliationCases } from './applications-reconcile-cases';
import { applicationRegistryCases } from './applications-registry-cases';
import { applicationStoreCases } from './applications-store-cases';

/**
 * The applications and grants contract: reading the registry, reconciling it
 * at start, and ending sessions by blocking a grant or switching an
 * application off. Every database runs these same cases through its own
 * harness, and offering a database means passing all of them.
 */
export function describeApplicationsContract(
  database: string,
  boot: () => Promise<ApplicationsContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`applications and grants contract on ${database}`, () => {
    let harness: ApplicationsContractHarness | undefined;
    const current = (): ApplicationsContractHarness => {
      if (!harness) {
        throw new Error(`the ${database} harness did not start`);
      }
      return harness;
    };

    beforeAll(async () => {
      harness = await boot();
    }, budgets.bootMs);

    afterAll(async () => {
      await harness?.authority.issuance.close();
    }, budgets.teardownMs);

    beforeEach(async () => {
      const { issuance } = current().authority;
      issuance.clock.set(TEST_NOW);
      await issuance.reset();
      await issuance.seedApplication(WEB_APPLICATION);
      await issuance.seedApplication(ADMIN_APPLICATION);
    }, budgets.resetMs);

    applicationRegistryCases(current);
    reconciliationCases(current);
    applicationAccessCases(current);
    applicationStoreCases(current);
    applicationAtomicityCases(current);
    applicationRaceCases(current);
    applicationClientReadCases(current);
  });
}

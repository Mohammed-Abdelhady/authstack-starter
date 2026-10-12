import { TEST_NOW } from '../../frozen-clock';
import { issuanceAccountReadCases } from './issuance-contract-account-read';
import { issuanceAtomicityCases } from './issuance-contract-atomicity';
import { IssuanceContractHarness } from './issuance-contract-harness';
import { issuanceRaceCases } from './issuance-contract-races';
import { issuanceRuleCases } from './issuance-contract-rules';
import { issuanceSeamCases } from './issuance-contract-seam';
import {
  ADMIN_APPLICATION,
  WEB_APPLICATION,
} from './issuance-contract-support';

/**
 * The browser sign-in contract. Every database runs these same cases through
 * its own harness, and offering a database means passing all of them.
 */
export function describeBrowserIssuanceContract(
  database: string,
  boot: () => Promise<IssuanceContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`browser sign-in contract on ${database}`, () => {
    let harness: IssuanceContractHarness | undefined;

    const current = (): IssuanceContractHarness => {
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
      await current().seedApplication(WEB_APPLICATION);
      await current().seedApplication(ADMIN_APPLICATION);
    }, budgets.resetMs);

    issuanceRuleCases(current);
    issuanceSeamCases(current);
    issuanceAtomicityCases(current);
    issuanceRaceCases(current);
    issuanceAccountReadCases(current);
  });
}

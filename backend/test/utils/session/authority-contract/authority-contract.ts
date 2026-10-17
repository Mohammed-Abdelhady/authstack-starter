import { authorityReadOutageCases } from './authority-read-outage-cases';
import { authorityLiveLimitCases } from './authority-live-limit-cases';
import { TEST_NOW } from '../../frozen-clock';
import {
  ADMIN_APPLICATION,
  WEB_APPLICATION,
} from '../issuance-contract/issuance-contract-support';
import { AuthorityContractHarness } from './authority-contract-harness';
import { authorityExtensionCases } from './authority-extension-cases';
import { authorityIdentityCases } from './authority-identity-cases';
import { authorityReadCases } from './authority-read-cases';
import { authorityValidationCases } from './authority-validation-cases';
import { accountRaceCases } from './revocation-account-race-cases';
import { revocationAtomicityCases } from './revocation-atomicity-cases';
import { revocationRouteIdCases } from './revocation-route-id-cases';
import { revocationRuleCases } from './revocation-rule-cases';
import { sessionRaceCases } from './revocation-session-race-cases';
import { revocationStoreCases } from './revocation-store-cases';

/**
 * The session authority contract: validating, listing and ending sessions.
 * Every database runs these same cases through its own harness, and offering a
 * database means passing all of them.
 */
export function describeSessionAuthorityContract(
  database: string,
  boot: () => Promise<AuthorityContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`session authority contract on ${database}`, () => {
    let harness: AuthorityContractHarness | undefined;
    const current = (): AuthorityContractHarness => {
      if (!harness) {
        throw new Error(`the ${database} harness did not start`);
      }
      return harness;
    };

    beforeAll(async () => {
      harness = await boot();
    }, budgets.bootMs);

    afterAll(async () => {
      await harness?.issuance.close();
    }, budgets.teardownMs);

    beforeEach(async () => {
      current().issuance.clock.set(TEST_NOW);
      await current().issuance.reset();
      await current().issuance.seedApplication(WEB_APPLICATION);
      await current().issuance.seedApplication(ADMIN_APPLICATION);
    }, budgets.resetMs);

    authorityValidationCases(current);
    authorityExtensionCases(current);
    authorityLiveLimitCases(current);
    authorityReadCases(current);
    authorityReadOutageCases(current);
    revocationRuleCases(current);
    revocationStoreCases(current);
    revocationAtomicityCases(current);
    sessionRaceCases(current);
    accountRaceCases(current);
    revocationRouteIdCases(current);
    authorityIdentityCases(current);
  });
}

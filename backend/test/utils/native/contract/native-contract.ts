import { TEST_NOW } from '../../frozen-clock';
import { WEB_APPLICATION } from '../../session/issuance-contract/issuance-contract-support';
import { accessCases } from './access-cases';
import { applicationJoinRaceCases } from './application-join-race-cases';
import { authorizationGuardCases } from './authorization-guard-cases';
import { authorizationRaceCases } from './authorization-race-cases';
import { authorizationRuleCases } from './authorization-rule-cases';
import { authorizationStoreCases } from './authorization-store-cases';
import { boundRefreshCases } from './bound-refresh-cases';
import { exchangeAuthorityCases } from './exchange-authority-cases';
import { exchangeCases } from './exchange-cases';
import { exchangeRaceCases } from './exchange-race-cases';
import { refreshAtomicityCases } from './refresh-atomicity-cases';
import { refreshCases } from './refresh-cases';
import { refreshRaceCases } from './refresh-race-cases';
import { replayRaceCases } from './replay-race-cases';
import { retryStoreCases } from './retry-store-cases';
import { revokeCases } from './revoke-cases';
import { rotationStoreCases } from './rotation-store-cases';
import { NativeContractHarness } from './native-contract-harness';

/**
 * The mobile sign-in contract: asking for a decision, exchanging a code,
 * rotating and ending a token family, and validating an access token. Every
 * database runs these same cases through its own harness, and offering a
 * database means passing all of them.
 */
export function describeNativeSignInContract(
  database: string,
  boot: () => Promise<NativeContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`mobile sign-in contract on ${database}`, () => {
    let harness: NativeContractHarness | undefined;
    const current = (): NativeContractHarness => {
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
      await current().reset();
      await current().issuance.seedApplication(WEB_APPLICATION);
      await current().seedNativeApplication();
    }, budgets.resetMs);

    authorizationRuleCases(current);
    authorizationGuardCases(current);
    authorizationStoreCases(current);
    authorizationRaceCases(current);
    exchangeCases(current);
    exchangeAuthorityCases(current);
    exchangeRaceCases(current);
    refreshCases(current);
    refreshAtomicityCases(current);
    boundRefreshCases(current);
    rotationStoreCases(current);
    retryStoreCases(current);
    refreshRaceCases(current);
    replayRaceCases(current);
    accessCases(current);
    revokeCases(current);
    applicationJoinRaceCases(current);
  });
}

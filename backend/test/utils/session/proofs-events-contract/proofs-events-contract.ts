import { TEST_NOW } from '../../frozen-clock';
import { eventAtomicityCases } from './event-atomicity-cases';
import { eventStoreCases } from './event-store-cases';
import { proofServiceCases } from './proof-service-cases';
import { proofStoreCases } from './proof-store-cases';
import { ProofsEventsContractHarness } from './proofs-events-contract-harness';

/**
 * The browser proof and security event contract. Every database runs these
 * same cases through its own harness.
 */
export function describeProofsEventsContract(
  database: string,
  boot: () => Promise<ProofsEventsContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`browser proof and security event contract on ${database}`, () => {
    let harness: ProofsEventsContractHarness | undefined;

    const current = (): ProofsEventsContractHarness => {
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
    }, budgets.resetMs);

    proofStoreCases(current);
    proofServiceCases(current);
    eventStoreCases(current);
    eventAtomicityCases(current);
  });
}

import { TEST_NOW } from '../frozen-clock';
import { sessionProofCases } from './session-proof-cases';
import { SessionProofHarness } from './session-proof-harness';

export function describeSessionProofContract(
  database: string,
  boot: () => Promise<SessionProofHarness>,
  budgets: { bootMs: number; resetMs: number; teardownMs: number },
): void {
  describe(`session proof contract on ${database}`, () => {
    let harness: SessionProofHarness | undefined;
    const current = (): SessionProofHarness => {
      if (!harness) throw new Error('session proof harness did not start');
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
    sessionProofCases(current);
  });
}

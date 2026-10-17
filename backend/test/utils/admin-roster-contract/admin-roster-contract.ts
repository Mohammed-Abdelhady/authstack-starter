import { AdminRosterHarness } from './admin-roster-harness';
import { rosterCases } from './admin-roster-cases';
import { rosterRaceCases } from './admin-roster-races';

export function describeAdminRosterContract(
  database: string,
  boot: () => Promise<AdminRosterHarness>,
  budgets: { bootMs: number; resetMs: number; teardownMs: number },
): void {
  describe(`administrator roster contract on ${database}`, () => {
    let harness: AdminRosterHarness | undefined;
    const current = (): AdminRosterHarness => {
      if (!harness)
        throw new Error('administrator roster harness did not start');
      return harness;
    };
    beforeAll(async () => {
      harness = await boot();
    }, budgets.bootMs);
    afterAll(async () => {
      await harness?.close();
    }, budgets.teardownMs);
    beforeEach(async () => {
      await current().reset();
    }, budgets.resetMs);
    rosterCases(current);
    rosterRaceCases(current);
  });
}

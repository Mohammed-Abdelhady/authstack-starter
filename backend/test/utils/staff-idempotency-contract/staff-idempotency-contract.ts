import { TEST_NOW } from '../frozen-clock';
import { staffIdempotencyCases } from './staff-idempotency-cases';
import { StaffIdempotencyHarness } from './staff-idempotency-harness';
import { staffIdempotencyRaces } from './staff-idempotency-races';

export function describeStaffIdempotencyContract(
  database: string,
  boot: () => Promise<StaffIdempotencyHarness>,
  budgets: { bootMs: number; resetMs: number; teardownMs: number },
): void {
  describe(`staff idempotency contract on ${database}`, () => {
    let harness: StaffIdempotencyHarness | undefined;
    const current = (): StaffIdempotencyHarness => {
      if (!harness) throw new Error('staff idempotency harness did not start');
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
    staffIdempotencyCases(current);
    staffIdempotencyRaces(current);
  });
}

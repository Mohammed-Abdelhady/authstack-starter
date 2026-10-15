import { TEST_NOW } from '../utils/frozen-clock';
import { accountRaceCases } from '../utils/session/authority-contract/revocation-account-race-cases';
import {
  WEB_APPLICATION,
  ADMIN_APPLICATION,
} from '../utils/session/issuance-contract/issuance-contract-support';
import { StaffSessionHarness } from './session-harness.harness-spec';
import { staffSessionCases } from './session-cases.harness-spec';
import { staffSessionAuthorizationCases } from './session-authorization-cases.harness-spec';
import { staffSessionAtomicityCases } from './session-atomicity-cases.harness-spec';
import { staffSessionBulkCases } from './session-bulk-cases.harness-spec';

export function describeStaffSessionsContract(
  database: string,
  boot: () => Promise<StaffSessionHarness>,
  budgets: { bootMs: number; resetMs: number; teardownMs: number },
): void {
  describe(`staff sessions on ${database}`, () => {
    let harness: StaffSessionHarness | undefined;
    const current = (): StaffSessionHarness => {
      if (!harness) throw new Error('staff sessions harness did not boot');
      return harness;
    };
    beforeAll(async () => {
      harness = await boot();
    }, budgets.bootMs);
    afterAll(async () => {
      await harness?.authority.issuance.close();
    }, budgets.teardownMs);
    beforeEach(async () => {
      const fixture = current();
      fixture.authority.issuance.clock.set(TEST_NOW);
      await fixture.authority.issuance.reset();
      await fixture.seedRoles();
      await fixture.authority.issuance.seedApplication(WEB_APPLICATION);
      await fixture.authority.issuance.seedApplication(ADMIN_APPLICATION);
    }, budgets.resetMs);
    staffSessionCases(current);
    staffSessionAuthorizationCases(current);
    staffSessionAtomicityCases(current);
    staffSessionBulkCases(current);
    accountRaceCases(() => current().authority);
  });
}

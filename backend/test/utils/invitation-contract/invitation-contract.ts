import { TEST_NOW } from '../frozen-clock';
import type { InvitationHarness } from './invitation-harness';
import { invitationCases } from './invitation-cases';
import { invitationRaceCases } from './invitation-races';
import { invitationIssuerCases } from './invitation-issuer-cases';

export function describeInvitationContract(
  database: string,
  boot: () => Promise<InvitationHarness>,
  budgets: { bootMs: number; resetMs: number; teardownMs: number },
): void {
  describe(`invitation contract on ${database}`, () => {
    let harness: InvitationHarness | undefined;
    const current = (): InvitationHarness => {
      if (!harness) throw new Error('Invitation harness did not start');
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
    invitationCases(current);
    invitationRaceCases(current);
    invitationIssuerCases(current);
  });
}

import { TEST_NOW } from '../frozen-clock';
import { AddressLedgerHarness } from './address-ledger-harness';
import { ledgerCases } from './address-ledger-cases';
import { ledgerRaceCases } from './address-ledger-races';

export function describeAddressLedgerContract(
  database: string,
  boot: () => Promise<AddressLedgerHarness>,
  budgets: { bootMs: number; resetMs: number; teardownMs: number },
): void {
  describe(`address ledger contract on ${database}`, () => {
    let harness: AddressLedgerHarness | undefined;
    const current = (): AddressLedgerHarness => {
      if (!harness) throw new Error('address ledger harness did not start');
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
    ledgerCases(current);
    ledgerRaceCases(current);
  });
}

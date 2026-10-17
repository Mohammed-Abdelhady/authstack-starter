import { magicLinkAudienceCases } from './magic-link-contract-audience.harness-spec';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { magicLinkBrowserCases } from './magic-link-contract-browser.harness-spec';
import { magicLinkCapCases } from './magic-link-contract-cap.harness-spec';
import { magicLinkCases } from './magic-link-contract-cases.harness-spec';
import { magicLinkSeamCases } from './magic-link-contract-seam.harness-spec';
import { magicLinkVerifyCases } from './magic-link-contract-verify.harness-spec';
import { MagicLinkContractHarness } from './magic-link-contract.harness-spec';

/**
 * The mailed sign-in link contract. Every database runs these same cases
 * through its own harness.
 */
export function describeMagicLinkContract(
  database: string,
  boot: () => Promise<MagicLinkContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`magic link contract on ${database}`, () => {
    let harness: MagicLinkContractHarness | undefined;

    const current = (): MagicLinkContractHarness => {
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

    afterEach(() => jest.restoreAllMocks());

    describe('requesting a link', () => magicLinkCases(current));
    describe('the hourly cap', () => magicLinkCapCases(current));
    describe('the browser that asked', () => magicLinkBrowserCases(current));
    describe('account audience', () => magicLinkAudienceCases(current));
    describe('spending a link', () => magicLinkVerifyCases(current));
    describe('the seam', () => magicLinkSeamCases(current));
  });
}

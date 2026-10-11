import * as bcrypt from 'bcrypt';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { challengeStoreCases } from './two-factor-contract-challenge-store.harness-spec';
import { challengeCases } from './two-factor-contract-challenge.harness-spec';
import { enrolmentCases } from './two-factor-contract-enrolment.harness-spec';
import { firstFactorCases } from './two-factor-contract-first-factor.harness-spec';
import { passwordOffCases } from './two-factor-contract-password-off.harness-spec';
import { passkeyStepCases } from './two-factor-contract-passkey-steps.harness-spec'; // feature:passkeys
import { seamCases } from './two-factor-contract-seam.harness-spec';
import { secondStepRefusalCases } from './two-factor-contract-second-step-refusals.harness-spec';
import { secondStepCases } from './two-factor-contract-second-step.harness-spec';
import { turningOffCases } from './two-factor-contract-turning-off.harness-spec';
import { spendingCases } from './two-factor-contract-spending.harness-spec';
import {
  BCRYPT_ROUNDS,
  OTHER_EMAIL,
  OWNER_EMAIL,
  PASSWORD,
  TwoFactorContractHarness,
  TwoFactorFixture,
} from './two-factor-contract.harness-spec';

/**
 * The second factor stores' contract. Every database runs these same cases
 * through its own harness, with the real services built on its adapters.
 */
export function describeTwoFactorContract(
  database: string,
  boot: () => Promise<TwoFactorContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`second factor contract on ${database}`, () => {
    let harness: TwoFactorContractHarness | undefined;
    let fixture: TwoFactorFixture | undefined;
    let passwordHash = '';

    const current = (): TwoFactorContractHarness => {
      if (!harness) {
        throw new Error(`the ${database} harness did not start`);
      }
      return harness;
    };
    const seeded = (): TwoFactorFixture => {
      if (!fixture) {
        throw new Error('the second factor fixture was not seeded');
      }
      return fixture;
    };

    beforeAll(async () => {
      passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
      harness = await boot();
    }, budgets.bootMs);

    afterAll(async () => {
      await harness?.close();
    }, budgets.teardownMs);

    beforeEach(async () => {
      const { clock } = current();
      clock.set(TEST_NOW);
      // The services read the time through Date.now, so it follows the clock.
      jest.spyOn(Date, 'now').mockImplementation(() => clock.now().getTime());
      await current().reset();
      fixture = {
        ownerId: await current().seedAccount({
          email: OWNER_EMAIL,
          passwordHash,
        }),
        otherId: await current().seedAccount({
          email: OTHER_EMAIL,
          passwordHash,
        }),
      };
    }, budgets.resetMs);

    afterEach(() => jest.restoreAllMocks());

    enrolmentCases(current, seeded);
    turningOffCases(current, seeded);
    passwordOffCases(current, seeded);
    spendingCases(current, seeded);
    challengeCases(current, seeded);
    challengeStoreCases(current, seeded);
    secondStepCases(current, seeded);
    secondStepRefusalCases(current, seeded);
    firstFactorCases(current, seeded);
    passkeyStepCases(current, seeded); // feature:passkeys
    seamCases(current, seeded);
  });
}

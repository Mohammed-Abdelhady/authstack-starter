import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { AccountsContractHarness } from '../../../../test/utils/user/accounts-contract/accounts-contract-harness';
import {
  seedAccountsFixture,
  servicesOn,
} from '../../../../test/utils/user/accounts-contract/accounts-contract-support';
import { SecondFactorStore } from '../stores/second-factor.store';

/** The account stores of one database, and its second factor store beside them. */
export interface SecondFactorDeletionHarness {
  readonly accounts: AccountsContractHarness;
  readonly secondFactor: SecondFactorStore;
}

const SECRET = { ciphertext: 'Y2lwaGVy', iv: 'aXY', tag: 'dGFn' };
const FIRST_CODE = 'a'.repeat(64);
const SECOND_CODE = 'b'.repeat(64);
const CONFIRMED_AT = new Date('2098-12-31T09:00:00.000Z');
const SPENT_STEP = 58_000_000;

/** Turns the factor on through the store, with one of two codes spent. */
async function enrol(store: SecondFactorStore, userId: string): Promise<void> {
  const read = async () => {
    const account = await store.findAccount(userId);
    if (!account) throw new Error(`account ${userId} is not stored`);
    return account;
  };
  await store.savePendingSecret(await read(), SECRET);
  await store.saveConfirmation(await read(), {
    recoveryCodeHashes: [FIRST_CODE, SECOND_CODE],
    confirmedAt: CONFIRMED_AT,
  });
  await store.spendTotpStep(await read(), SPENT_STEP);
  await store.spendRecoveryCode(await read(), FIRST_CODE, TEST_NOW);
}

/**
 * What the account's own workflows leave of a second factor. Every database
 * runs this same case, with the real account services on its adapters.
 */
export function describeSecondFactorAfterDeletion(
  database: string,
  boot: () => Promise<SecondFactorDeletionHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`second factor of a deleted account on ${database}`, () => {
    let harness: SecondFactorDeletionHarness | undefined;

    const current = (): SecondFactorDeletionHarness => {
      if (!harness) {
        throw new Error(`the ${database} harness did not start`);
      }
      return harness;
    };

    beforeAll(async () => {
      harness = await boot();
    }, budgets.bootMs);

    afterAll(async () => {
      await harness?.accounts.close();
    }, budgets.teardownMs);

    beforeEach(async () => {
      current().accounts.clock.set(TEST_NOW);
      await current().accounts.reset();
    }, budgets.resetMs);

    it('keeps the second factor of an account that left and of one an admin deleted', async () => {
      const { accounts, secondFactor } = current();
      const { adminId, userId, supportId } =
        await seedAccountsFixture(accounts);
      await enrol(secondFactor, userId);
      await enrol(secondFactor, supportId);
      const services = servicesOn(accounts);

      await services.profile.deactivateAccount(userId);
      await services.adminUsers.deleteUser(supportId, adminId);

      const kept = {
        enabled: true,
        secret: SECRET,
        confirmedAt: CONFIRMED_AT,
        recoveryCodes: [
          { hash: FIRST_CODE, usedAt: TEST_NOW },
          { hash: SECOND_CODE, usedAt: null },
        ],
        lastUsedStep: SPENT_STEP,
      };
      expect({
        left: await secondFactor.findAccount(userId),
        deleted: await secondFactor.findAccount(supportId),
        challenged: await secondFactor.findChallengedAccount(userId),
      }).toEqual({
        left: {
          id: userId,
          email: 'person@example.test',
          isDeleted: true,
          twoFactor: kept,
        },
        deleted: {
          id: supportId,
          email: 'support@example.test',
          isDeleted: true,
          twoFactor: kept,
        },
        challenged: {
          id: userId,
          email: 'person@example.test',
          isDeleted: true,
          twoFactor: kept,
        },
      });
    });
  });
}

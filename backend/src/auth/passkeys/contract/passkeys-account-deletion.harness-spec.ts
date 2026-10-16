import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { AccountsContractHarness } from '../../../../test/utils/user/accounts-contract/accounts-contract-harness';
import { seedAccountsFixture } from '../../../../test/utils/user/accounts-contract/accounts-contract-fixture';
import { servicesOn } from '../../../../test/utils/user/accounts-contract/accounts-contract-support';
import { PasskeyAccounts } from '../stores/passkey-accounts';
import { PasskeyStore } from '../stores/passkey.store';

/** The account stores of one database, and its passkey stores beside them. */
export interface PasskeyDeletionHarness {
  readonly accounts: AccountsContractHarness;
  readonly passkeys: PasskeyStore;
  readonly passkeyAccounts: PasskeyAccounts;
}

const LEAVER_CREDENTIAL = 'bGVhdmVyLWtleQ';
const DELETED_CREDENTIAL = 'ZGVsZXRlZC1rZXk';

function register(
  store: PasskeyStore,
  userId: string,
  credentialId: string,
): Promise<unknown> {
  return store.insert({
    userId,
    rpId: 'localhost',
    credentialId,
    publicKey: Buffer.from([1, 2, 3]),
    counter: 4,
    transports: ['usb'],
    deviceType: 'singleDevice',
    backedUp: false,
    name: `Key ${credentialId}`,
  });
}

/** What a caller can read of an account's passkeys, without the stored ids. */
async function passkeysOf(
  harness: PasskeyDeletionHarness,
  userId: string,
  credentialId: string,
): Promise<unknown> {
  const listed = await harness.passkeys.listForAccount(userId);
  return {
    account: await harness.passkeyAccounts.findAccount(userId),
    listed: listed.map((passkey) => ({
      credentialId: passkey.credentialId,
      name: passkey.name,
      counter: passkey.counter,
    })),
    owner: (await harness.passkeys.findByCredentialId(credentialId))?.userId,
    count: await harness.passkeys.countForAccount(userId),
    profileCount: await harness.accounts.profiles.countPasskeys(userId),
  };
}

/**
 * What the account's own workflows leave of its passkeys. Every database runs
 * this same case, with the real account services on its adapters.
 */
export function describePasskeysAfterDeletion(
  database: string,
  boot: () => Promise<PasskeyDeletionHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`passkeys of a deleted account on ${database}`, () => {
    let harness: PasskeyDeletionHarness | undefined;

    const current = (): PasskeyDeletionHarness => {
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

    it('keeps the passkeys of an account that left and of one an admin deleted', async () => {
      const { accounts, passkeys } = current();
      const { adminId, userId, supportId } =
        await seedAccountsFixture(accounts);
      await register(passkeys, userId, LEAVER_CREDENTIAL);
      await register(passkeys, supportId, DELETED_CREDENTIAL);
      const services = servicesOn(accounts);

      await services.profile.deactivateAccount(userId);
      await services.adminUsers.deleteUser(supportId, adminId);

      expect({
        left: await passkeysOf(current(), userId, LEAVER_CREDENTIAL),
        deleted: await passkeysOf(current(), supportId, DELETED_CREDENTIAL),
      }).toEqual({
        left: {
          account: {
            id: userId,
            email: 'person@example.test',
            name: 'Plain Person',
            isDeleted: true,
          },
          listed: [
            {
              credentialId: LEAVER_CREDENTIAL,
              name: 'Key bGVhdmVyLWtleQ',
              counter: 4,
            },
          ],
          owner: userId,
          count: 1,
          profileCount: 1,
        },
        deleted: {
          account: {
            id: supportId,
            email: 'support@example.test',
            name: 'Contract Tester',
            isDeleted: true,
          },
          listed: [
            {
              credentialId: DELETED_CREDENTIAL,
              name: 'Key ZGVsZXRlZC1rZXk',
              counter: 4,
            },
          ],
          owner: supportId,
          count: 1,
          profileCount: 1,
        },
      });
    });
  });
}

import { EMAIL_CHANGE_INITIATOR } from '../../../auth/constants/email-change-initiator';
import {
  bootMongoAccountsHarness,
  type MongoAccountsHarness,
} from '../../../../test/utils/user/accounts-contract/mongo-accounts-harness';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/hook-timeouts';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';

describe('Mongo retained account activity boundary', () => {
  let h: MongoAccountsHarness;
  beforeAll(async () => {
    h = await bootMongoAccountsHarness();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await h?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    await h.reset();
    h.clock.set(TEST_NOW);
    await h.seedRole({ slug: 'user', name: 'Member', permissions: [] });
  }, SESSION_AUTHORITY_RESET_TIMEOUT_MS);

  it('clears the staff marker and pending address together through the ordinary versioned save', async () => {
    const id = await h.seedAccount({
      email: 'clear-marker@example.test',
      role: 'user',
    });
    const runner = h.runner(() => Promise.resolve());
    const pending = await runner.run(async (work) => {
      const account = await h.admin.takeAccountForChange(work, id);
      if (!account) throw new Error('The account is missing');
      return h.admin.saveIdentity(work, account, {
        address: { email: 'pending@example.test', addressGeneration: 1 },
      });
    });
    expect(
      (await h.booted.users.findById(id).lean().exec())?.pendingEmailInitiator,
    ).toBe(EMAIL_CHANGE_INITIATOR.STAFF);
    await runner.run(async (work) => {
      const account = await h.admin.takeAccountForChange(work, id);
      if (!account) throw new Error('The account is missing');
      await h.admin.saveIdentity(work, account, {
        address: { email: null, addressGeneration: 2 },
      });
    });
    const cleared = await h.booted.users.findById(id).lean().exec();
    expect(cleared).toMatchObject({
      email: 'clear-marker@example.test',
      addressGeneration: 2,
      version: (pending.version ?? 0) + 1,
    });
    expect(cleared?.pendingEmail).toBeUndefined();
    expect(cleared?.pendingEmailInitiator).toBeUndefined();
  });
});

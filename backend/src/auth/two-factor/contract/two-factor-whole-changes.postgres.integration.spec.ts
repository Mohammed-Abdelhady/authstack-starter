import { bootPostgresTwoFactorHarness } from '../../../../test/postgres/postgres-two-factor-harness';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { SecondFactorAccount } from '../stores/second-factor-account';
import {
  OTHER_RECOVERY_HASH,
  OWNER_EMAIL,
  RECOVERY_HASH,
  rejectionOf,
  StoredSecondFactorFacts,
  TwoFactorContractHarness,
} from './two-factor-contract.harness-spec';

/**
 * A change to the second factor is several statements, so it can be caught
 * half done.
 * A batch with the same hash twice breaks the table's unique rule on its
 * second row, after the statements before it have run.
 */

const NOW = new Date('2099-01-01T12:00:00.000Z');
const TWICE = ['4'.repeat(64), '5'.repeat(64), '4'.repeat(64)];
const PENDING: StoredSecondFactorFacts = {
  enabled: false,
  secret: { ciphertext: 'Y2lwaGVy', iv: 'aXY=', tag: 'dGFn' },
  confirmedAt: null,
  recoveryCodes: [
    { hash: RECOVERY_HASH, usedAt: NOW },
    { hash: OTHER_RECOVERY_HASH, usedAt: null },
  ],
  lastUsedStep: 9,
};

describe('second factor changes on PostgreSQL are whole', () => {
  let harness: TwoFactorContractHarness;
  let account: SecondFactorAccount;

  beforeAll(async () => {
    harness = await bootPostgresTwoFactorHarness();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await harness.reset();
    const ownerId = await harness.seedAccount({ email: OWNER_EMAIL });
    await harness.seedSecondFactor(ownerId, PENDING);
    const read = await harness.accounts.findAccount(ownerId);
    if (!read) throw new Error('the seeded account was not found');
    account = read;
  }, POSTGRES_RESET_TIMEOUT_MS);

  it('leaves the factor off and the old codes in place when a confirmation is refused part way', async () => {
    const refused = await rejectionOf(
      harness.accounts.saveConfirmation(account, {
        recoveryCodeHashes: TWICE,
        confirmedAt: NOW,
      }),
    );

    expect(refused).toBeInstanceOf(UniqueConflictError);
    expect(await harness.secondFactor(account.id)).toEqual(PENDING);
  });

  it('keeps the old recovery codes when their replacement is refused part way', async () => {
    const refused = await rejectionOf(
      harness.accounts.replaceRecoveryCodes(account, TWICE),
    );

    expect(refused).toBeInstanceOf(UniqueConflictError);
    expect(await harness.secondFactor(account.id)).toEqual(PENDING);
  });
});

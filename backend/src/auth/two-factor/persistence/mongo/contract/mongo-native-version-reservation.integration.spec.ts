import { TEST_NOW } from '../../../../../../test/utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/hook-timeouts';
import { ATTEMPT_RESERVATION } from '../../../stores/second-factor.store';
import {
  bootMongoTwoFactorHarness,
  type MongoTwoFactorHarness,
} from './mongo-two-factor.harness-spec';

describe('MongoDB native MFA reservation on legacy accounts', () => {
  let harness: MongoTwoFactorHarness;

  beforeAll(async () => {
    harness = await bootMongoTwoFactorHarness();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await harness.reset();
  });

  for (const legacyVersion of [undefined, null]) {
    it(`counts a native answer when stored sessionVersion is ${String(legacyVersion)}`, async () => {
      const userId = await harness.seedAccount({
        email: 'legacy@example.test',
      });
      await harness.seedSecondFactor(userId, {
        enabled: true,
        secret: null,
        confirmedAt: TEST_NOW,
        recoveryCodes: [],
        lastUsedStep: null,
      });
      await harness.setRawSessionVersion(userId, legacyVersion);
      expect(await harness.mappedSessionVersion(userId)).toBe(0);
      const account = await harness.accounts.findChallengedAccount(userId);
      if (!account) throw new Error('seed account missing');

      const reservation = await harness.accounts.reserveAttempt(
        account,
        { failedAttempts: 1, lockedUntil: null },
        0,
      );

      expect(reservation).toBe(ATTEMPT_RESERVATION.RESERVED);
      expect(await harness.failures(userId)).toEqual({
        failedAttempts: 1,
        lockedUntil: null,
      });
    });
  }

  it('keeps positive account versions exact', async () => {
    const userId = await harness.seedAccount({
      email: 'versioned@example.test',
    });
    await harness.seedSecondFactor(userId, {
      enabled: true,
      secret: null,
      confirmedAt: TEST_NOW,
      recoveryCodes: [],
      lastUsedStep: null,
    });
    await harness.setRawSessionVersion(userId, 2);
    const account = await harness.accounts.findChallengedAccount(userId);
    if (!account) throw new Error('seed account missing');

    const stale = await harness.accounts.reserveAttempt(
      account,
      { failedAttempts: 1, lockedUntil: null },
      1,
    );
    const current = await harness.accounts.reserveAttempt(
      account,
      { failedAttempts: 1, lockedUntil: null },
      2,
    );

    expect(stale).toBe(ATTEMPT_RESERVATION.REFUSED);
    expect(current).toBe(ATTEMPT_RESERVATION.RESERVED);
    expect(await harness.failures(userId)).toEqual({
      failedAttempts: 1,
      lockedUntil: null,
    });
  });
});

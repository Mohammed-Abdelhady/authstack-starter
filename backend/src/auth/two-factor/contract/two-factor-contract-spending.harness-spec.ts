import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import { SecondFactorAccount } from '../stores/second-factor-account';
import {
  codeAt,
  OTHER_RECOVERY_HASH,
  outcomeOf,
  RECOVERY_CODE,
  RECOVERY_HASH,
  refusalOf,
  seedEnabled,
  STEP_AT_TEST_NOW,
  TOTP_SECRET,
  twoFactorCase,
  TwoFactorContractHarness,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
} from './two-factor-contract.harness-spec';

const CODE_INVALID = { code: 'TWO_FACTOR_CODE_INVALID', status: 401 };
const NOW = new Date('2099-01-01T12:00:00.000Z');

async function readAccount(
  harness: TwoFactorContractHarness,
  userId: string,
): Promise<SecondFactorAccount> {
  const account = await harness.accounts.findAccount(userId);
  if (!account) {
    throw new Error('the seeded account was not found');
  }
  return account;
}

/** A code or a recovery code works once, whoever asks and however fast. */
export function spendingCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  twoFactorCase(
    'spends a step once: the same code and an older one are refused, the next is taken',
    async () => {
      const { ownerId } = fixture();
      const { verification, crypto } = twoFactorServices(harness());
      const { clock } = harness();
      await seedEnabled(harness(), crypto, ownerId);

      await verification.verifyTotpCode(
        await readAccount(harness(), ownerId),
        codeAt(clock, TOTP_SECRET),
      );
      expect((await harness().secondFactor(ownerId)).lastUsedStep).toBe(
        STEP_AT_TEST_NOW,
      );

      expect(
        await refusalOf(
          verification.verifyTotpCode(
            await readAccount(harness(), ownerId),
            codeAt(clock, TOTP_SECRET),
          ),
        ),
      ).toEqual(CODE_INVALID);
      expect(
        await refusalOf(
          verification.verifyTotpCode(
            await readAccount(harness(), ownerId),
            codeAt(clock, TOTP_SECRET, -1),
          ),
        ),
      ).toEqual(CODE_INVALID);
      expect((await harness().secondFactor(ownerId)).lastUsedStep).toBe(
        STEP_AT_TEST_NOW,
      );

      await verification.verifyTotpCode(
        await readAccount(harness(), ownerId),
        codeAt(clock, TOTP_SECRET, 1),
      );
      expect((await harness().secondFactor(ownerId)).lastUsedStep).toBe(
        STEP_AT_TEST_NOW + 1,
      );
    },
  );

  twoFactorCase('accepts one of two simultaneous uses of a code', async () => {
    const { ownerId } = fixture();
    const { verification, crypto } = twoFactorServices(harness());
    await seedEnabled(harness(), crypto, ownerId);
    const code = codeAt(harness().clock, TOTP_SECRET);
    // Both requests read the account before either is counted, which is the
    // first write an answer makes.
    const first = await readAccount(harness(), ownerId);
    const second = await readAccount(harness(), ownerId);
    const gate = new RaceGate();
    const restore = holdBefore(
      harness().accounts,
      'reserveAttempt',
      () => gate,
    );

    const attempts = [
      outcomeOf(verification.verifyTotpCode(first, code)),
      outcomeOf(verification.verifyTotpCode(second, code)),
    ];
    await gate.reached(2);
    gate.release();
    const outcomes = await Promise.all(attempts);
    restore();

    expect(outcomes.sort()).toEqual(['TWO_FACTOR_CODE_INVALID', 'accepted']);
    expect((await harness().secondFactor(ownerId)).lastUsedStep).toBe(
      STEP_AT_TEST_NOW,
    );
  });

  twoFactorCase(
    'refuses a step the record was not read with and stores nothing for it',
    async () => {
      const { ownerId } = fixture();
      const { crypto } = twoFactorServices(harness());
      const { accounts } = harness();
      await seedEnabled(harness(), crypto, ownerId);
      const stale = await readAccount(harness(), ownerId);

      expect(await accounts.spendTotpStep(stale, 10)).toBe('spent');
      expect(await accounts.spendTotpStep(stale, 11)).toBe('already_spent');
      expect((await harness().secondFactor(ownerId)).lastUsedStep).toBe(10);

      const fresh = await readAccount(harness(), ownerId);
      expect(fresh.twoFactor.lastUsedStep).toBe(10);
      expect(await accounts.spendTotpStep(fresh, 11)).toBe('spent');
      expect((await harness().secondFactor(ownerId)).lastUsedStep).toBe(11);
    },
  );

  twoFactorCase(
    'spends a recovery code once, as typed, and leaves the others',
    async () => {
      const { ownerId } = fixture();
      const { verification, crypto } = twoFactorServices(harness());
      await seedEnabled(harness(), crypto, ownerId);
      const readBefore = await readAccount(harness(), ownerId);

      await verification.verifyRecoveryCode(readBefore, 'k3m7q-rtvwx');

      expect((await harness().secondFactor(ownerId)).recoveryCodes).toEqual([
        { hash: RECOVERY_HASH, usedAt: NOW },
        { hash: OTHER_RECOVERY_HASH, usedAt: null },
      ]);
      expect(
        (await readAccount(harness(), ownerId)).twoFactor.recoveryCodes,
      ).toEqual([
        { hash: RECOVERY_HASH, usedAt: NOW },
        { hash: OTHER_RECOVERY_HASH, usedAt: null },
      ]);
      expect(
        await refusalOf(
          verification.verifyRecoveryCode(
            await readAccount(harness(), ownerId),
            RECOVERY_CODE,
          ),
        ),
      ).toEqual(CODE_INVALID);
      // A record read before the code was spent still shows it as unspent.
      expect(
        await refusalOf(
          verification.verifyRecoveryCode(readBefore, RECOVERY_CODE),
        ),
      ).toEqual(CODE_INVALID);
      expect(
        await refusalOf(
          verification.verifyRecoveryCode(readBefore, 'AAAAAAAAAA'),
        ),
      ).toEqual(CODE_INVALID);
    },
  );

  twoFactorCase(
    'accepts one of two simultaneous uses of a recovery code',
    async () => {
      const { ownerId } = fixture();
      const { verification, crypto } = twoFactorServices(harness());
      await seedEnabled(harness(), crypto, ownerId);
      const first = await readAccount(harness(), ownerId);
      const second = await readAccount(harness(), ownerId);
      const gate = new RaceGate();
      const restore = holdBefore(
        harness().accounts,
        'reserveAttempt',
        () => gate,
      );

      const attempts = [
        outcomeOf(verification.verifyRecoveryCode(first, RECOVERY_CODE)),
        outcomeOf(verification.verifyRecoveryCode(second, RECOVERY_CODE)),
      ];
      await gate.reached(2);
      gate.release();
      const outcomes = await Promise.all(attempts);
      restore();

      expect(outcomes.sort()).toEqual(['TWO_FACTOR_CODE_INVALID', 'accepted']);
      expect((await harness().secondFactor(ownerId)).recoveryCodes).toEqual([
        { hash: RECOVERY_HASH, usedAt: NOW },
        { hash: OTHER_RECOVERY_HASH, usedAt: null },
      ]);
    },
  );

  twoFactorCase(
    'spends no code of another account and none it never had',
    async () => {
      const { ownerId, otherId } = fixture();
      const { crypto } = twoFactorServices(harness());
      const { accounts } = harness();
      await seedEnabled(harness(), crypto, ownerId, {
        recoveryCodes: [{ hash: RECOVERY_HASH, usedAt: null }],
      });
      await seedEnabled(harness(), crypto, otherId, {
        recoveryCodes: [{ hash: OTHER_RECOVERY_HASH, usedAt: null }],
      });
      const owner = await readAccount(harness(), ownerId);

      expect(
        await accounts.spendRecoveryCode(owner, OTHER_RECOVERY_HASH, NOW),
      ).toBe('already_spent');
      expect(await accounts.spendRecoveryCode(owner, 'f'.repeat(64), NOW)).toBe(
        'already_spent',
      );

      expect((await harness().secondFactor(otherId)).recoveryCodes).toEqual([
        { hash: OTHER_RECOVERY_HASH, usedAt: null },
      ]);
      expect((await harness().secondFactor(ownerId)).recoveryCodes).toEqual([
        { hash: RECOVERY_HASH, usedAt: null },
      ]);
    },
  );

  twoFactorCase(
    'takes the code when both arrive, the recovery code when only it does, and refuses neither',
    async () => {
      const { ownerId } = fixture();
      const { verification, crypto } = twoFactorServices(harness());
      await seedEnabled(harness(), crypto, ownerId);

      await verification.verifySecondFactor(
        await readAccount(harness(), ownerId),
        {
          code: codeAt(harness().clock, TOTP_SECRET),
          recoveryCode: RECOVERY_CODE,
        },
      );
      expect(await harness().secondFactor(ownerId)).toMatchObject({
        lastUsedStep: STEP_AT_TEST_NOW,
        recoveryCodes: [
          { hash: RECOVERY_HASH, usedAt: null },
          { hash: OTHER_RECOVERY_HASH, usedAt: null },
        ],
      });

      await verification.verifySecondFactor(
        await readAccount(harness(), ownerId),
        { recoveryCode: RECOVERY_CODE },
      );
      expect(await harness().secondFactor(ownerId)).toMatchObject({
        lastUsedStep: STEP_AT_TEST_NOW,
        recoveryCodes: [
          { hash: RECOVERY_HASH, usedAt: NOW },
          { hash: OTHER_RECOVERY_HASH, usedAt: null },
        ],
      });

      expect(
        await refusalOf(
          verification.verifySecondFactor(
            await readAccount(harness(), ownerId),
            {},
          ),
        ),
      ).toEqual(CODE_INVALID);
    },
  );
}

import { createHash } from 'node:crypto';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  codeAt,
  NO_SECOND_FACTOR,
  OTHER_RECOVERY_HASH,
  PASSWORD,
  RECOVERY_CODE,
  RECOVERY_CODES_PER_BATCH,
  RECOVERY_HASH,
  refusalOf,
  seedEnabled,
  STEP_AT_TEST_NOW,
  TOTP_SECRET,
  twoFactorCase,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
  wrongCode,
} from './two-factor-contract.harness-spec';

const WRONG_PASSWORD = { code: 'INVALID_CURRENT_PASSWORD', status: 400 };
const CODE_INVALID = { code: 'TWO_FACTOR_CODE_INVALID', status: 401 };
const NOT_ENABLED = { code: 'TWO_FACTOR_NOT_ENABLED', status: 400 };
const NOT_FOUND = { code: 'USER_NOT_FOUND', status: 404 };
const INVALID_INPUT = { code: 'INVALID_INPUT', status: 400 };

/** The stored form of a recovery code, worked out apart from the service. */
function sha256(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Turning the factor off, replacing its codes, and accounts that cannot be changed. */
export function turningOffCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  twoFactorCase(
    'turns the factor off with a code and the password and removes every trace',
    async () => {
      const { ownerId } = fixture();
      const { settings, crypto } = twoFactorServices(harness());
      await seedEnabled(harness(), crypto, ownerId);

      await settings.disable(ownerId, {
        code: codeAt(harness().clock, TOTP_SECRET),
        password: PASSWORD,
      });

      expect(await harness().secondFactor(ownerId)).toEqual(NO_SECOND_FACTOR);
      expect(await harness().profileSaysEnabled(ownerId)).toBe(false);
    },
  );

  twoFactorCase(
    'turns the factor off with a recovery code in place of a code',
    async () => {
      const { ownerId } = fixture();
      const { settings, crypto } = twoFactorServices(harness());
      await seedEnabled(harness(), crypto, ownerId);

      await settings.disable(ownerId, {
        recoveryCode: RECOVERY_CODE,
        password: PASSWORD,
      });

      expect(await harness().secondFactor(ownerId)).toEqual(NO_SECOND_FACTOR);
    },
  );

  twoFactorCase(
    'keeps the factor on when the password or the code is wrong, and refuses an account without one',
    async () => {
      const { ownerId, otherId } = fixture();
      const { settings, crypto } = twoFactorServices(harness());
      const { clock } = harness();
      await seedEnabled(harness(), crypto, ownerId);
      const before = await harness().secondFactor(ownerId);

      expect(
        await refusalOf(
          settings.disable(ownerId, {
            code: codeAt(clock, TOTP_SECRET),
            password: 'NotThePassword1!',
          }),
        ),
      ).toEqual(WRONG_PASSWORD);
      expect(
        await refusalOf(
          settings.disable(ownerId, {
            code: wrongCode(clock, TOTP_SECRET),
            password: PASSWORD,
          }),
        ),
      ).toEqual(CODE_INVALID);
      expect(
        await refusalOf(
          settings.disable(otherId, {
            code: codeAt(clock, TOTP_SECRET),
            password: PASSWORD,
          }),
        ),
      ).toEqual(NOT_ENABLED);
      // Neither refusal spent the code or a recovery code.
      expect(await harness().secondFactor(ownerId)).toEqual(before);
      expect(before.enabled).toBe(true);
    },
  );

  twoFactorCase('replaces every recovery code, spent or not', async () => {
    const { ownerId } = fixture();
    const { settings, crypto } = twoFactorServices(harness());
    await seedEnabled(harness(), crypto, ownerId, {
      recoveryCodes: [
        { hash: RECOVERY_HASH, usedAt: TEST_NOW },
        { hash: OTHER_RECOVERY_HASH, usedAt: null },
      ],
    });

    const replaced = await settings.regenerateRecoveryCodes(ownerId, {
      code: codeAt(harness().clock, TOTP_SECRET),
      password: PASSWORD,
    });

    const codes = replaced.data.recoveryCodes;
    const stored = await harness().secondFactor(ownerId);
    expect(codes).toHaveLength(RECOVERY_CODES_PER_BATCH);
    expect(stored.recoveryCodes).toEqual(
      codes.map((code) => ({ hash: sha256(code), usedAt: null })),
    );
    expect(stored.recoveryCodes.map((code) => code.hash)).not.toContain(
      RECOVERY_HASH,
    );
    expect(stored.recoveryCodes.map((code) => code.hash)).not.toContain(
      OTHER_RECOVERY_HASH,
    );
    expect(stored.enabled).toBe(true);
    expect(stored.lastUsedStep).toBe(STEP_AT_TEST_NOW);
  });

  twoFactorCase('keeps the recovery codes when the code is wrong', async () => {
    const { ownerId } = fixture();
    const { settings, crypto } = twoFactorServices(harness());
    await seedEnabled(harness(), crypto, ownerId);
    const before = await harness().secondFactor(ownerId);

    expect(
      await refusalOf(
        settings.regenerateRecoveryCodes(ownerId, {
          code: wrongCode(harness().clock, TOTP_SECRET),
          password: PASSWORD,
        }),
      ),
    ).toEqual(CODE_INVALID);
    expect(await harness().secondFactor(ownerId)).toEqual(before);
    expect(before.recoveryCodes).toEqual([
      { hash: RECOVERY_HASH, usedAt: null },
      { hash: OTHER_RECOVERY_HASH, usedAt: null },
    ]);
  });

  twoFactorCase(
    'answers not found for an absent or deactivated account and invalid input for a malformed id',
    async () => {
      const { ownerId } = fixture();
      const { settings } = twoFactorServices(harness());
      const code = codeAt(harness().clock, TOTP_SECRET);
      await harness().setDeleted(ownerId, true);

      for (const userId of [harness().absentId(), ownerId]) {
        expect(
          await refusalOf(
            settings.setup(userId, { password: PASSWORD }, undefined),
          ),
        ).toEqual(NOT_FOUND);
        expect(await refusalOf(settings.confirm(userId, { code }))).toEqual(
          NOT_FOUND,
        );
      }
      for (const userId of ['not-an-id', '', harness().foreignId()]) {
        expect(
          await refusalOf(
            settings.setup(userId, { password: PASSWORD }, undefined),
          ),
        ).toEqual(INVALID_INPUT);
        expect(await refusalOf(settings.confirm(userId, { code }))).toEqual(
          INVALID_INPUT,
        );
      }
    },
  );
}

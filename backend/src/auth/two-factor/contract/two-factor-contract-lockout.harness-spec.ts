import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  FIRST_LOCK_MS,
  LONGEST_LOCK_MS,
  CODE_INVALID,
  LOCKED,
  SPARE_CODES,
  after,
  answerOf,
  read,
  wrongSignIn,
} from './two-factor-contract-lockout-support.harness-spec';
import {
  challengedBrowser,
  codeAt,
  NO_FAILURES,
  OTHER_RECOVERY_HASH,
  outcomeOf,
  RECOVERY_CODE,
  RECOVERY_HASH,
  seedEnabled,
  STEP_AT_TEST_NOW,
  TOTP_SECRET,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
  wrongCode,
} from './two-factor-contract.harness-spec';

/** Wrong answers are counted on the account, and every fifth locks it. */
export function lockoutCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('adds up wrong codes across sign-ins, locks at the fifth and refuses the right code without checking it', async () => {
    const { ownerId, otherId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId);
    await seedEnabled(harness(), services.crypto, otherId);

    const counted: number[] = [];
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // A sign-in of its own each time: no challenge sees a second answer.
      outcomes.push(await wrongSignIn(harness(), services, ownerId));
      counted.push((await harness().failures(ownerId)).failedAttempts);
    }
    const holder = await challengedBrowser(services, ownerId);
    const locked = await answerOf(
      services.login.verify(
        { code: codeAt(harness().clock, TOTP_SECRET) },
        holder.request,
        holder.response,
      ),
    );

    expect(outcomes).toEqual([
      CODE_INVALID,
      CODE_INVALID,
      CODE_INVALID,
      CODE_INVALID,
      CODE_INVALID,
    ]);
    expect(counted).toEqual([1, 2, 3, 4, 5]);
    expect(locked).toEqual({ code: LOCKED, status: 429, retryAfter: 60 });
    expect(await harness().failures(ownerId)).toEqual({
      failedAttempts: 5,
      lockedUntil: after(FIRST_LOCK_MS),
    });
    // The right code was not checked: its step is unspent and nobody signed in.
    expect((await harness().secondFactor(ownerId)).lastUsedStep).toBeNull();
    expect(services.signIn.accountIds).toEqual([]);
    expect(await harness().failures(otherId)).toEqual(NO_FAILURES);
  });

  it('holds the lock until its last millisecond, then takes the right code and starts the count again', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const { clock } = harness();
    await seedEnabled(harness(), services.crypto, ownerId);
    await harness().seedFailures(ownerId, {
      failedAttempts: 5,
      lockedUntil: after(FIRST_LOCK_MS),
    });

    clock.advance(FIRST_LOCK_MS - 1);
    const lastMillisecond = await answerOf(
      services.verification.verifyTotpCode(
        await read(harness(), ownerId),
        codeAt(clock, TOTP_SECRET),
      ),
    );
    clock.advance(1);
    await services.verification.verifyTotpCode(
      await read(harness(), ownerId),
      codeAt(clock, TOTP_SECRET),
    );

    expect(lastMillisecond).toEqual({
      code: LOCKED,
      status: 429,
      retryAfter: 1,
    });
    expect(await harness().failures(ownerId)).toEqual(NO_FAILURES);
    expect((await harness().secondFactor(ownerId)).lastUsedStep).toBe(
      STEP_AT_TEST_NOW + 2,
    );
  });

  it('starts the count again after a right answer, so four more wrong ones do not lock', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const { clock } = harness();
    await seedEnabled(harness(), services.crypto, ownerId);
    const wrong = async (): Promise<string> =>
      outcomeOf(
        services.verification.verifyTotpCode(
          await read(harness(), ownerId),
          wrongCode(clock, TOTP_SECRET),
        ),
      );

    for (let attempt = 0; attempt < 4; attempt += 1) await wrong();
    const beforeTheRightOne = await harness().failures(ownerId);
    await services.verification.verifyRecoveryCode(
      await read(harness(), ownerId),
      RECOVERY_CODE,
    );
    const afterTheRightOne = await harness().failures(ownerId);
    for (let attempt = 0; attempt < 4; attempt += 1) await wrong();

    expect(beforeTheRightOne).toEqual({ failedAttempts: 4, lockedUntil: null });
    expect(afterTheRightOne).toEqual(NO_FAILURES);
    expect(await harness().failures(ownerId)).toEqual({
      failedAttempts: 4,
      lockedUntil: null,
    });
  });

  it.each([
    [4, FIRST_LOCK_MS],
    [9, 120_000],
    [14, 240_000],
    [29, 1_920_000],
    [34, LONGEST_LOCK_MS],
    [59, LONGEST_LOCK_MS],
  ])(
    'locks for longer each time: the wrong answer after %i locks for %i ms',
    async (failedAttempts, lockMs) => {
      const { ownerId } = fixture();
      const services = twoFactorServices(harness());
      await seedEnabled(harness(), services.crypto, ownerId);
      await harness().seedFailures(ownerId, {
        failedAttempts,
        lockedUntil: null,
      });

      const outcome = await outcomeOf(
        services.verification.verifyTotpCode(
          await read(harness(), ownerId),
          wrongCode(harness().clock, TOTP_SECRET),
        ),
      );

      expect(outcome).toBe(CODE_INVALID);
      expect(await harness().failures(ownerId)).toEqual({
        failedAttempts: failedAttempts + 1,
        lockedUntil: after(lockMs),
      });
    },
  );

  it('goes on counting from a lock that ended, and locks again only at the next fifth', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId);
    await harness().seedFailures(ownerId, {
      failedAttempts: 5,
      lockedUntil: new Date(TEST_NOW.getTime() - 1),
    });

    const outcome = await outcomeOf(
      services.verification.verifyTotpCode(
        await read(harness(), ownerId),
        wrongCode(harness().clock, TOTP_SECRET),
      ),
    );

    expect(outcome).toBe(CODE_INVALID);
    expect(await harness().failures(ownerId)).toEqual({
      failedAttempts: 6,
      lockedUntil: null,
    });
  });

  it('counts wrong recovery codes and wrong setup codes the same way', async () => {
    const { ownerId, otherId } = fixture();
    const services = twoFactorServices(harness());
    const { clock } = harness();
    await seedEnabled(harness(), services.crypto, ownerId);
    // The other account ran setup and has not confirmed it.
    await seedEnabled(harness(), services.crypto, otherId, {
      enabled: false,
      confirmedAt: null,
      recoveryCodes: [],
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await outcomeOf(
        services.verification.verifyRecoveryCode(
          await read(harness(), ownerId),
          SPARE_CODES[attempt],
        ),
      );
      await outcomeOf(
        services.settings.confirm(otherId, {
          code: wrongCode(clock, TOTP_SECRET),
        }),
      );
    }
    const recovery = await answerOf(
      services.verification.verifyRecoveryCode(
        await read(harness(), ownerId),
        RECOVERY_CODE,
      ),
    );
    const confirm = await answerOf(
      services.settings.confirm(otherId, { code: codeAt(clock, TOTP_SECRET) }),
    );

    const locked = { code: LOCKED, status: 429, retryAfter: 60 };
    expect({ recovery, confirm }).toEqual({
      recovery: locked,
      confirm: locked,
    });
    expect((await harness().secondFactor(ownerId)).recoveryCodes).toEqual([
      { hash: RECOVERY_HASH, usedAt: null },
      { hash: OTHER_RECOVERY_HASH, usedAt: null },
    ]);
    expect((await harness().secondFactor(otherId)).enabled).toBe(false);
  });
}

import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import {
  FIRST_LOCK_MS,
  CODE_INVALID,
  SPARE_CODES,
  sha256,
  after,
  read,
} from './two-factor-contract-lockout-support.harness-spec';
import {
  codeAt,
  NO_FAILURES,
  outcomeOf,
  refusalOf,
  seedEnabled,
  TOTP_SECRET,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
} from './two-factor-contract.harness-spec';

/** What is counted when answers arrive together, and what is never counted. */
export function lockoutRaceCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('checks one of six right answers sent together, so answers in flight cannot outrun the count', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId, {
      recoveryCodes: SPARE_CODES.map((code) => ({
        hash: sha256(code),
        usedAt: null,
      })),
    });
    await harness().seedFailures(ownerId, {
      failedAttempts: 4,
      lockedUntil: null,
    });
    // Every request reads the account before any of them is counted.
    const readTogether = await Promise.all(
      SPARE_CODES.map(() => read(harness(), ownerId)),
    );
    const gate = new RaceGate();
    const restore = holdBefore(
      harness().accounts,
      'reserveAttempt',
      () => gate,
    );

    const attempts = SPARE_CODES.map((code, index) =>
      outcomeOf(
        services.verification.verifyRecoveryCode(readTogether[index], code),
      ),
    );
    await gate.reached(6);
    gate.release();
    const outcomes = await Promise.all(attempts);
    restore();

    expect(outcomes.sort()).toEqual([
      CODE_INVALID,
      CODE_INVALID,
      CODE_INVALID,
      CODE_INVALID,
      CODE_INVALID,
      'accepted',
    ]);
    const spent = (await harness().secondFactor(ownerId)).recoveryCodes.filter(
      (code) => code.usedAt !== null,
    );
    expect(spent).toHaveLength(1);
  });

  it('counts one of three wrong answers sent together, and the two it refused were never checked', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId);
    await harness().seedFailures(ownerId, {
      failedAttempts: 4,
      lockedUntil: null,
    });
    const readTogether = await Promise.all(
      [0, 1, 2].map(() => read(harness(), ownerId)),
    );
    const gate = new RaceGate();
    const restore = holdBefore(
      harness().accounts,
      'reserveAttempt',
      () => gate,
    );

    const attempts = readTogether.map((account, index) =>
      outcomeOf(
        services.verification.verifyRecoveryCode(account, SPARE_CODES[index]),
      ),
    );
    await gate.reached(3);
    gate.release();
    const outcomes = await Promise.all(attempts);
    restore();

    expect(outcomes).toEqual([CODE_INVALID, CODE_INVALID, CODE_INVALID]);
    expect(await harness().failures(ownerId)).toEqual({
      failedAttempts: 5,
      lockedUntil: after(FIRST_LOCK_MS),
    });
  });

  it('counts an answer only for the state it was read with, and clears the count of its own account', async () => {
    const { ownerId, otherId } = fixture();
    const { crypto } = twoFactorServices(harness());
    const { accounts } = harness();
    await seedEnabled(harness(), crypto, ownerId);
    await seedEnabled(harness(), crypto, otherId);
    await harness().seedFailures(otherId, {
      failedAttempts: 3,
      lockedUntil: null,
    });
    const stale = await read(harness(), ownerId);
    const lockedUntil = after(FIRST_LOCK_MS);

    const first = await accounts.reserveAttempt(stale, {
      failedAttempts: 1,
      lockedUntil,
    });
    const second = await accounts.reserveAttempt(stale, {
      failedAttempts: 9,
      lockedUntil: null,
    });
    const stored = await harness().failures(ownerId);
    const readBack = (await read(harness(), ownerId)).twoFactor;
    await accounts.clearFailedAttempts(stale);

    expect({ first, second }).toEqual({ first: 'reserved', second: 'refused' });
    expect(stored).toEqual({ failedAttempts: 1, lockedUntil });
    expect({
      failedAttempts: readBack.failedAttempts,
      lockedUntil: readBack.lockedUntil,
    }).toEqual({ failedAttempts: 1, lockedUntil });
    expect(await harness().failures(ownerId)).toEqual(NO_FAILURES);
    expect(await harness().failures(otherId)).toEqual({
      failedAttempts: 3,
      lockedUntil: null,
    });
  });

  it('counts nothing for a request without an answer, or one the server could not read the secret for', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId);
    // A server whose key is not the one the secret was stored under.
    const unreadable = twoFactorServices(harness(), [], {
      current: Buffer.alloc(32, 31).toString('base64'),
    });

    const empty = await refusalOf(
      services.verification.verifySecondFactor(
        await read(harness(), ownerId),
        {},
      ),
    );
    const noKey = await refusalOf(
      unreadable.verification.verifyTotpCode(
        await read(harness(), ownerId),
        codeAt(harness().clock, TOTP_SECRET),
      ),
    );

    expect(empty).toEqual({ code: CODE_INVALID, status: 401 });
    expect(noKey).toEqual({ code: 'TWO_FACTOR_NOT_CONFIGURED', status: 503 });
    expect(await harness().failures(ownerId)).toEqual(NO_FAILURES);
  });
}

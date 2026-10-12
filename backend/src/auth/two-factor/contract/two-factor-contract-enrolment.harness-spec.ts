import { createHash } from 'node:crypto';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  codeAt,
  FRESH_SESSION_MS,
  NO_SECOND_FACTOR,
  PASSWORD,
  RECOVERY_CODES_PER_BATCH,
  RECOVERY_HASH,
  refusalOf,
  seedEnabled,
  STEP_AT_TEST_NOW,
  TOTP_SECRET,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
  wrongCode,
} from './two-factor-contract.harness-spec';

const REAUTH_REQUIRED = { code: 'REAUTH_REQUIRED', status: 401 };
const WRONG_PASSWORD = { code: 'INVALID_CURRENT_PASSWORD', status: 400 };
const CODE_INVALID = { code: 'TWO_FACTOR_CODE_INVALID', status: 401 };
const ALREADY_ENABLED = { code: 'TWO_FACTOR_ALREADY_ENABLED', status: 409 };
const SETUP_REQUIRED = { code: 'TWO_FACTOR_SETUP_REQUIRED', status: 400 };

/** The stored form of a recovery code, worked out apart from the service. */
function sha256(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Turning the factor on, off, and replacing its recovery codes. */
export function enrolmentCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('stores an unconfirmed secret and leaves the factor off', async () => {
    const { ownerId } = fixture();
    const { settings, crypto } = twoFactorServices(harness());

    const started = await settings.setup(
      ownerId,
      { password: PASSWORD },
      undefined,
    );

    const stored = await harness().secondFactor(ownerId);
    expect(started.data.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(stored.secret?.ciphertext).not.toContain(started.data.secret);
    expect({
      ...stored,
      secret: stored.secret ? crypto.decrypt(stored.secret) : null,
    }).toEqual({ ...NO_SECOND_FACTOR, secret: started.data.secret });
    expect(await harness().profileSaysEnabled(ownerId)).toBe(false);
  });

  it('refuses setup without the password or with a wrong one and stores nothing', async () => {
    const { ownerId } = fixture();
    const { settings } = twoFactorServices(harness());
    const freshSession = { createdAt: harness().clock.now() };

    expect(await refusalOf(settings.setup(ownerId, {}, freshSession))).toEqual(
      REAUTH_REQUIRED,
    );
    expect(
      await refusalOf(
        settings.setup(ownerId, { password: 'NotThePassword1!' }, undefined),
      ),
    ).toEqual(WRONG_PASSWORD);
    expect(await harness().secondFactor(ownerId)).toEqual(NO_SECOND_FACTOR);
  });

  it('takes a session of five minutes from an account without a password, and none older', async () => {
    const passwordlessId = await harness().seedAccount({
      email: 'passwordless@example.test',
    });
    const { settings } = twoFactorServices(harness());
    const startedAt = (ageMs: number): { createdAt: Date } => ({
      createdAt: new Date(TEST_NOW.getTime() - ageMs),
    });

    expect(
      await refusalOf(
        settings.setup(passwordlessId, {}, startedAt(FRESH_SESSION_MS + 1)),
      ),
    ).toEqual(REAUTH_REQUIRED);
    expect(
      await refusalOf(settings.setup(passwordlessId, {}, undefined)),
    ).toEqual(REAUTH_REQUIRED);
    expect(await harness().secondFactor(passwordlessId)).toEqual(
      NO_SECOND_FACTOR,
    );

    await settings.setup(passwordlessId, {}, startedAt(FRESH_SESSION_MS));

    expect((await harness().secondFactor(passwordlessId)).secret).not.toBe(
      null,
    );
  });

  it('replaces a pending secret when setup runs again and forgets its spent step', async () => {
    const { ownerId } = fixture();
    const { settings, crypto } = twoFactorServices(harness());
    await harness().seedSecondFactor(ownerId, {
      ...NO_SECOND_FACTOR,
      secret: crypto.encrypt(TOTP_SECRET),
      recoveryCodes: [{ hash: RECOVERY_HASH, usedAt: null }],
      lastUsedStep: 7,
    });

    const started = await settings.setup(
      ownerId,
      { password: PASSWORD },
      undefined,
    );

    const stored = await harness().secondFactor(ownerId);
    expect(started.data.secret).not.toBe(TOTP_SECRET);
    expect({
      ...stored,
      secret: stored.secret ? crypto.decrypt(stored.secret) : null,
    }).toEqual({ ...NO_SECOND_FACTOR, secret: started.data.secret });
  });

  it('refuses setup while the factor is on and keeps its secret', async () => {
    const { ownerId } = fixture();
    const { settings, crypto } = twoFactorServices(harness());
    await seedEnabled(harness(), crypto, ownerId);

    expect(
      await refusalOf(
        settings.setup(ownerId, { password: PASSWORD }, undefined),
      ),
    ).toEqual(ALREADY_ENABLED);

    const stored = await harness().secondFactor(ownerId);
    expect(stored.enabled).toBe(true);
    expect(stored.secret ? crypto.decrypt(stored.secret) : null).toBe(
      TOTP_SECRET,
    );
  });

  it('turns the factor on with a first correct code and stores ten unused recovery codes', async () => {
    const { ownerId } = fixture();
    const { settings, crypto } = twoFactorServices(harness());
    await harness().seedSecondFactor(ownerId, {
      ...NO_SECOND_FACTOR,
      secret: crypto.encrypt(TOTP_SECRET),
    });

    const confirmed = await settings.confirm(ownerId, {
      code: codeAt(harness().clock, TOTP_SECRET),
    });

    const codes = confirmed.data.recoveryCodes;
    const stored = await harness().secondFactor(ownerId);
    expect(codes).toHaveLength(RECOVERY_CODES_PER_BATCH);
    expect(new Set(codes).size).toBe(RECOVERY_CODES_PER_BATCH);
    expect({ ...stored, secret: null }).toEqual({
      enabled: true,
      secret: null,
      confirmedAt: new Date('2099-01-01T12:00:00.000Z'),
      recoveryCodes: codes.map((code) => ({
        hash: sha256(code),
        usedAt: null,
      })),
      lastUsedStep: STEP_AT_TEST_NOW,
    });
    expect(stored.secret ? crypto.decrypt(stored.secret) : null).toBe(
      TOTP_SECRET,
    );
    expect(await harness().profileSaysEnabled(ownerId)).toBe(true);
  });

  it('keeps the factor off without setup or on a wrong code, and refuses a second confirm', async () => {
    const { ownerId, otherId } = fixture();
    const { settings, crypto } = twoFactorServices(harness());
    const { clock } = harness();
    const pending = {
      ...NO_SECOND_FACTOR,
      secret: crypto.encrypt(TOTP_SECRET),
    };
    await harness().seedSecondFactor(ownerId, pending);

    expect(
      await refusalOf(
        settings.confirm(otherId, { code: codeAt(clock, TOTP_SECRET) }),
      ),
    ).toEqual(SETUP_REQUIRED);
    expect(
      await refusalOf(
        settings.confirm(ownerId, { code: wrongCode(clock, TOTP_SECRET) }),
      ),
    ).toEqual(CODE_INVALID);
    expect(await harness().secondFactor(ownerId)).toEqual(pending);
    expect(await harness().profileSaysEnabled(ownerId)).toBe(false);

    await settings.confirm(ownerId, { code: codeAt(clock, TOTP_SECRET) });
    expect(
      await refusalOf(
        settings.confirm(ownerId, { code: codeAt(clock, TOTP_SECRET, 1) }),
      ),
    ).toEqual(ALREADY_ENABLED);
  });
}

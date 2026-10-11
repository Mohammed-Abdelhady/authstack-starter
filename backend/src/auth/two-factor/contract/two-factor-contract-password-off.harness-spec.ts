import { ConfigService } from '@nestjs/config';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { HashService } from '../../../common/services/hash.service';
import { passwordSwitch } from '../services/password-switch.harness-spec';
import { TwoFactorReauthService } from '../services/two-factor-reauth.service';
import { TwoFactorService } from '../two-factor.service';
import {
  BCRYPT_ROUNDS,
  codeAt,
  FRESH_SESSION_MS,
  NO_SECOND_FACTOR,
  PASSWORD,
  refusalOf,
  seedEnabled,
  TOTP_SECRET,
  TwoFactorContractHarness,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
  TwoFactorServices,
  wrongCode,
} from './two-factor-contract.harness-spec';

const REAUTH_REQUIRED = { code: 'REAUTH_REQUIRED', status: 401 };
const CODE_INVALID = { code: 'TWO_FACTOR_CODE_INVALID', status: 401 };
const NOT_THE_PASSWORD = 'NotThePassword1!';

/** A session that started this long before the frozen time. */
function startedAgo(ageMs: number): { createdAt: Date } {
  return { createdAt: new Date(TEST_NOW.getTime() - ageMs) };
}

/** The real services of a deployment that turned password sign-in off. */
function servicesWithPasswordOff(
  harness: TwoFactorContractHarness,
): TwoFactorServices {
  const services = twoFactorServices(harness);
  const hashes = new HashService(
    new ConfigService({ bcrypt: { rounds: BCRYPT_ROUNDS } }),
  );
  return {
    ...services,
    settings: new TwoFactorService(
      harness.accounts,
      services.crypto,
      services.verification,
      new TwoFactorReauthService(hashes, passwordSwitch(false)),
    ),
  };
}

/**
 * Changing the second factor where password sign-in is off. A stored password
 * proves nothing there: a recent sign-in starts setup, a code turns it off.
 */
export function passwordOffCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('starts setup on a recent sign-in for an account that still stores a password, with password sign-in off', async () => {
    const { ownerId } = fixture();
    const { settings, crypto } = servicesWithPasswordOff(harness());

    const started = await settings.setup(
      ownerId,
      {},
      startedAgo(FRESH_SESSION_MS),
    );

    const stored = await harness().secondFactor(ownerId);
    expect({
      enabled: stored.enabled,
      secret: stored.secret ? crypto.decrypt(stored.secret) : null,
    }).toEqual({ enabled: false, secret: started.data.secret });
  });

  it('refuses setup on an older sign-in even with the stored password, with password sign-in off', async () => {
    const { ownerId } = fixture();
    const { settings } = servicesWithPasswordOff(harness());

    expect(
      await refusalOf(
        settings.setup(
          ownerId,
          { password: PASSWORD },
          startedAgo(FRESH_SESSION_MS + 1),
        ),
      ),
    ).toEqual(REAUTH_REQUIRED);
    expect(
      await refusalOf(
        settings.setup(ownerId, { password: PASSWORD }, undefined),
      ),
    ).toEqual(REAUTH_REQUIRED);
    expect(await harness().secondFactor(ownerId)).toEqual(NO_SECOND_FACTOR);
  });

  it('does not read a password sent with a recent sign-in, with password sign-in off', async () => {
    const { ownerId } = fixture();
    const { settings } = servicesWithPasswordOff(harness());

    await settings.setup(
      ownerId,
      { password: NOT_THE_PASSWORD },
      startedAgo(0),
    );

    expect((await harness().secondFactor(ownerId)).secret).not.toBe(null);
  });

  it('turns the factor off with a code alone for an account that still stores a password, with password sign-in off', async () => {
    const { ownerId } = fixture();
    const { settings, crypto } = servicesWithPasswordOff(harness());
    await seedEnabled(harness(), crypto, ownerId);

    await settings.disable(ownerId, {
      code: codeAt(harness().clock, TOTP_SECRET),
    });

    expect(await harness().secondFactor(ownerId)).toEqual(NO_SECOND_FACTOR);
  });

  it('keeps the factor on after a wrong code even with the stored password, with password sign-in off', async () => {
    const { ownerId } = fixture();
    const { settings, crypto } = servicesWithPasswordOff(harness());
    await seedEnabled(harness(), crypto, ownerId);
    const before = await harness().secondFactor(ownerId);

    expect(
      await refusalOf(
        settings.disable(ownerId, {
          code: wrongCode(harness().clock, TOTP_SECRET),
          password: PASSWORD,
        }),
      ),
    ).toEqual(CODE_INVALID);
    expect(await harness().secondFactor(ownerId)).toEqual(before);
    expect(before.enabled).toBe(true);
  });

  it('asks an account without a password for the same proof, with password sign-in off', async () => {
    const passwordlessId = await harness().seedAccount({
      email: 'passwordless-off@example.test',
    });
    const { settings, crypto } = servicesWithPasswordOff(harness());

    expect(
      await refusalOf(
        settings.setup(passwordlessId, {}, startedAgo(FRESH_SESSION_MS + 1)),
      ),
    ).toEqual(REAUTH_REQUIRED);
    await settings.setup(passwordlessId, {}, startedAgo(FRESH_SESSION_MS));
    expect((await harness().secondFactor(passwordlessId)).secret).not.toBe(
      null,
    );

    await seedEnabled(harness(), crypto, passwordlessId);
    expect(
      await refusalOf(
        settings.disable(passwordlessId, {
          code: wrongCode(harness().clock, TOTP_SECRET),
        }),
      ),
    ).toEqual(CODE_INVALID);
    await settings.disable(passwordlessId, {
      code: codeAt(harness().clock, TOTP_SECRET),
    });
    expect(await harness().secondFactor(passwordlessId)).toEqual(
      NO_SECOND_FACTOR,
    );
  });
}

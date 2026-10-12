import { ConfigService } from '@nestjs/config';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { AppException } from '../../../common/exceptions/app.exception';
import { HashService } from '../../../common/services/hash.service';
import { partialMock } from '../../../common/testing/test-doubles.harness-spec';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { PasskeyRegistrationReauth } from '../../passkeys/services/passkey-registration-reauth.service';
import { PasskeyAccounts } from '../../passkeys/stores/passkey-accounts';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import {
  BCRYPT_ROUNDS,
  codeAt,
  NO_FAILURES,
  OTHER_RECOVERY_HASH,
  PASSWORD,
  RECOVERY_CODE,
  RECOVERY_HASH,
  seedEnabled,
  STEP_AT_TEST_NOW,
  TOTP_SECRET,
  TwoFactorContractHarness,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  TwoFactorServices,
  twoFactorServices,
  wrongCode,
} from './two-factor-contract.harness-spec';

const SESSION = { createdAt: TEST_NOW };
const CODE_NEEDED = {
  code: 'REAUTH_REQUIRED',
  status: 401,
  detail: 'second_factor',
};

interface Refusal {
  code: string;
  status: number;
  /** What the answer says to bring, or how long to wait. */
  detail: unknown;
}

async function refusalOf(promise: Promise<unknown>): Promise<Refusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) {
      const details = error.getDetails();
      return {
        code: error.code,
        status: error.getStatus(),
        detail: details?.required ?? details?.retryAfter,
      };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

/**
 * The feature switches as the case sets them: password sign-in on, so the
 * same cases hold in a project generated without that method.
 */
class Switches extends AuthFeaturesService {
  constructor(private readonly twoFactorOn: boolean) {
    super(new ConfigService());
  }

  override isEnabled(feature: AuthFeature): boolean {
    if (feature === AuthFeature.PASSWORD) return true;
    if (feature === AuthFeature.TWO_FACTOR) return this.twoFactorOn;
    return super.isEnabled(feature);
  }
}

/**
 * The real check before a passkey is added, on this database's second factor
 * store. The account's password is read through that same store.
 */
function reauthOn(
  harness: TwoFactorContractHarness,
  services: TwoFactorServices,
  twoFactorOn = true,
): PasskeyRegistrationReauth {
  return new PasskeyRegistrationReauth(
    new HashService(new ConfigService({ bcrypt: { rounds: BCRYPT_ROUNDS } })),
    new Switches(twoFactorOn),
    partialMock<PasskeyAccounts>({
      findPassword: async (userId: string) => {
        const account = await harness.accounts.findAccountWithPassword(userId);
        return account ? { passwordHash: account.passwordHash } : null;
      },
    }),
    harness.accounts,
    services.verification,
  );
}

/** Adding a passkey to an account that has the second factor on. */
export function passkeyRegistrationCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('asks an account with the factor on for a code as well as its password, and takes a code or a recovery code', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const reauth = reauthOn(harness(), services);
    await seedEnabled(harness(), services.crypto, ownerId);

    const withoutACode = await refusalOf(
      reauth.assertMayAddPasskey(ownerId, { password: PASSWORD }, SESSION),
    );
    const untouched = await harness().secondFactor(ownerId);
    await reauth.assertMayAddPasskey(
      ownerId,
      { password: PASSWORD, code: codeAt(harness().clock, TOTP_SECRET) },
      SESSION,
    );
    await reauth.assertMayAddPasskey(
      ownerId,
      { password: PASSWORD, recoveryCode: RECOVERY_CODE },
      SESSION,
    );

    expect(withoutACode).toEqual(CODE_NEEDED);
    expect(untouched.lastUsedStep).toBeNull();
    // Each proof was spent, as it is at sign-in.
    expect(await harness().secondFactor(ownerId)).toMatchObject({
      lastUsedStep: STEP_AT_TEST_NOW,
      recoveryCodes: [
        { hash: RECOVERY_HASH, usedAt: TEST_NOW },
        { hash: OTHER_RECOVERY_HASH, usedAt: null },
      ],
    });
  });

  it('refuses a wrong code and counts it, and refuses the right one while the account is locked', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const reauth = reauthOn(harness(), services);
    const { clock } = harness();
    await seedEnabled(harness(), services.crypto, ownerId);
    await harness().seedFailures(ownerId, {
      failedAttempts: 4,
      lockedUntil: null,
    });

    const wrong = await refusalOf(
      reauth.assertMayAddPasskey(
        ownerId,
        { password: PASSWORD, code: wrongCode(clock, TOTP_SECRET) },
        SESSION,
      ),
    );
    const locked = await refusalOf(
      reauth.assertMayAddPasskey(
        ownerId,
        { password: PASSWORD, code: codeAt(clock, TOTP_SECRET) },
        SESSION,
      ),
    );

    expect(wrong).toEqual({
      code: 'TWO_FACTOR_CODE_INVALID',
      status: 401,
      detail: undefined,
    });
    expect(locked).toEqual({
      code: 'TWO_FACTOR_LOCKED',
      status: 429,
      detail: 60,
    });
    expect((await harness().failures(ownerId)).failedAttempts).toBe(5);
  });

  it('checks the password first, so a caller without it spends no code and no guess', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const reauth = reauthOn(harness(), services);
    const { clock } = harness();
    await seedEnabled(harness(), services.crypto, ownerId);
    const before = await harness().secondFactor(ownerId);

    const wrongPassword = await refusalOf(
      reauth.assertMayAddPasskey(
        ownerId,
        { password: 'NotThePassword1!', code: codeAt(clock, TOTP_SECRET) },
        SESSION,
      ),
    );
    const noPassword = await refusalOf(
      reauth.assertMayAddPasskey(
        ownerId,
        { code: wrongCode(clock, TOTP_SECRET) },
        SESSION,
      ),
    );

    expect(wrongPassword).toEqual({
      code: 'INVALID_CURRENT_PASSWORD',
      status: 400,
      detail: undefined,
    });
    expect(noPassword).toEqual({
      code: 'REAUTH_REQUIRED',
      status: 401,
      detail: 'password',
    });
    expect(await harness().secondFactor(ownerId)).toEqual(before);
    expect(await harness().failures(ownerId)).toEqual(NO_FAILURES);
  });

  it('asks for no code where the factor is off, only started, or switched off for the deployment', async () => {
    const { ownerId, otherId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId);
    // The other account ran setup and never confirmed it.
    await seedEnabled(harness(), services.crypto, otherId, {
      enabled: false,
      confirmedAt: null,
      recoveryCodes: [],
    });
    const neverSetUp = await harness().seedAccount({
      email: 'never-set-up@example.test',
    });
    const proof = { password: PASSWORD };

    const outcomes = [
      await reauthOn(harness(), services).assertMayAddPasskey(
        otherId,
        proof,
        SESSION,
      ),
      await reauthOn(harness(), services).assertMayAddPasskey(
        neverSetUp,
        {},
        SESSION,
      ),
      await reauthOn(harness(), services, false).assertMayAddPasskey(
        ownerId,
        proof,
        SESSION,
      ),
    ];

    expect(outcomes).toEqual([undefined, undefined, undefined]);
    expect((await harness().secondFactor(ownerId)).lastUsedStep).toBeNull();
  });

  it('asks an account without a password for a recent sign-in and a code', async () => {
    const services = twoFactorServices(harness());
    const reauth = reauthOn(harness(), services);
    const { clock } = harness();
    const passwordless = await harness().seedAccount({
      email: 'passwordless@example.test',
    });
    await seedEnabled(harness(), services.crypto, passwordless);
    const old = { createdAt: new Date(TEST_NOW.getTime() - 300_001) };

    const oldSession = await refusalOf(
      reauth.assertMayAddPasskey(
        passwordless,
        { code: codeAt(clock, TOTP_SECRET) },
        old,
      ),
    );
    const noCode = await refusalOf(
      reauth.assertMayAddPasskey(passwordless, {}, SESSION),
    );
    const unspent = (await harness().secondFactor(passwordless)).lastUsedStep;
    await reauth.assertMayAddPasskey(
      passwordless,
      { code: codeAt(clock, TOTP_SECRET) },
      SESSION,
    );

    expect(oldSession).toEqual({
      code: 'REAUTH_REQUIRED',
      status: 401,
      detail: 'recent_sign_in',
    });
    expect(noCode).toEqual(CODE_NEEDED);
    expect(unspent).toBeNull();
    expect((await harness().secondFactor(passwordless)).lastUsedStep).toBe(
      STEP_AT_TEST_NOW,
    );
  });
}

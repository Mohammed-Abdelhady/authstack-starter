import { ConfigService } from '@nestjs/config';
import { partialMock } from '../../../common/testing/test-doubles.harness-spec';
import { RolePermissions } from '../../../role/stores/role-permissions';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { SessionCookieService } from '../../services/sessions/session-cookie.service';
import { Sessions } from '../../services/sessions/sessions';
import { SignInCompletion } from '../../services/sessions/sign-in-completion';
import {
  FIRST_LOCK_MS,
  LOCKED,
  after,
  answerOf,
} from './two-factor-contract-lockout-support.harness-spec';
import {
  browser,
  codeAt,
  NO_FAILURES,
  OWNER_EMAIL,
  PASSWORD,
  RECOVERY_CODE,
  refusalOf,
  seedEnabled,
  TOTP_SECRET,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
  wrongCode,
} from './two-factor-contract.harness-spec';

/** The lock on the settings routes, and what it leaves open. */
export function lockoutRouteCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('answers a right and a wrong code alike while locked, on the settings routes as on sign-in', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const { clock } = harness();
    await seedEnabled(harness(), services.crypto, ownerId);
    await harness().seedFailures(ownerId, {
      failedAttempts: 5,
      lockedUntil: after(FIRST_LOCK_MS),
    });
    clock.advance(20_000);
    const before = await harness().secondFactor(ownerId);
    const expected = { code: LOCKED, status: 429, retryAfter: 40 };

    const answers = [
      await answerOf(
        services.settings.disable(ownerId, {
          code: codeAt(clock, TOTP_SECRET),
          password: PASSWORD,
        }),
      ),
      await answerOf(
        services.settings.disable(ownerId, {
          code: wrongCode(clock, TOTP_SECRET),
          password: PASSWORD,
        }),
      ),
      await answerOf(
        services.settings.disable(ownerId, {
          recoveryCode: RECOVERY_CODE,
          password: PASSWORD,
        }),
      ),
      await answerOf(
        services.settings.regenerateRecoveryCodes(ownerId, {
          code: codeAt(clock, TOTP_SECRET),
          password: PASSWORD,
        }),
      ),
    ];

    expect(answers).toEqual([expected, expected, expected, expected]);
    expect(await harness().secondFactor(ownerId)).toEqual(before);
    // An answer during the lock is not counted and does not extend it.
    expect(await harness().failures(ownerId)).toEqual({
      failedAttempts: 5,
      lockedUntil: after(FIRST_LOCK_MS),
    });
  });

  it('still takes the first factor of a locked account and holds the sign-in for its second step', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId);
    await harness().seedFailures(ownerId, {
      failedAttempts: 5,
      lockedUntil: after(FIRST_LOCK_MS),
    });
    const browserApplications = services.browserApplications;
    const config = new ConfigService({});
    const completion = new SignInCompletion(
      partialMock<RolePermissions>({}),
      partialMock<Sessions>({
        assertAdmission: () => Promise.resolve(),
      }),
      partialMock<SessionCookieService>({}),
      new AuthFeaturesService(config, browserApplications),
      services.challenge,
      browserApplications,
    );
    const holder = browser();

    const outcome = await completion.completeSignIn(
      {
        id: ownerId,
        email: OWNER_EMAIL,
        name: 'Owner',
        role: 'user',
        permissions: [],
        authProvider: 'email',
        isVerified: true,
        twoFactorEnabled: true,
      },
      holder.response,
      'password',
    );

    expect(outcome).toEqual({ requiresTwoFactor: true });
    expect(await harness().storedChallenges()).toMatchObject([
      { userId: ownerId, attempts: 0, claimed: false },
    ]);
  });

  it('asks for the password before the code when the recovery codes are replaced, and counts no wrong password', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const { clock } = harness();
    await seedEnabled(harness(), services.crypto, ownerId);
    const passwordless = await harness().seedAccount({
      email: 'passwordless@example.test',
    });
    await seedEnabled(harness(), services.crypto, passwordless);
    const before = await harness().secondFactor(ownerId);

    const missing = await refusalOf(
      services.settings.regenerateRecoveryCodes(ownerId, {
        code: codeAt(clock, TOTP_SECRET),
      }),
    );
    const wrong = await refusalOf(
      services.settings.regenerateRecoveryCodes(ownerId, {
        code: codeAt(clock, TOTP_SECRET),
        password: 'NotThePassword1!',
      }),
    );
    const unchanged = await harness().secondFactor(ownerId);
    const codeAlone = await services.settings.regenerateRecoveryCodes(
      passwordless,
      { code: codeAt(clock, TOTP_SECRET) },
    );

    expect(missing).toEqual({ code: 'REAUTH_REQUIRED', status: 401 });
    expect(wrong).toEqual({ code: 'INVALID_CURRENT_PASSWORD', status: 400 });
    // Neither refusal spent the code, replaced a recovery code or was counted.
    expect(unchanged).toEqual(before);
    expect(await harness().failures(ownerId)).toEqual(NO_FAILURES);
    expect(codeAlone.data.recoveryCodes).toHaveLength(10);
  });
}

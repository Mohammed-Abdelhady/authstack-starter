import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import {
  browser,
  CHALLENGE_COOKIE,
  challengedBrowser,
  codeAt,
  MAX_WRONG_ANSWERS,
  OTHER_RECOVERY_HASH,
  outcomeOf,
  RECOVERY_CODE,
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

const CHALLENGE_INVALID = {
  code: 'TWO_FACTOR_CHALLENGE_INVALID',
  status: 401,
};
const CODE_INVALID = { code: 'TWO_FACTOR_CODE_INVALID', status: 401 };
const NOW = new Date('2099-01-01T12:00:00.000Z');

/** The sign-in second step: a correct answer to an open challenge, once. */
export function secondStepCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('signs in on a correct code and spends the challenge', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId);
    const holder = await challengedBrowser(services, ownerId);

    const answer = await services.login.verify(
      { code: codeAt(harness().clock, TOTP_SECRET) },
      holder.request,
      holder.response,
    );

    expect(answer.data).toMatchObject({
      requiresTwoFactor: false,
      user: { id: ownerId },
    });
    expect(services.signIn.accountIds).toEqual([ownerId]);
    expect(await harness().storedChallenges()).toEqual([]);
    expect(holder.cookies).toEqual({});
    expect((await harness().secondFactor(ownerId)).lastUsedStep).toBe(
      STEP_AT_TEST_NOW,
    );
  });

  it('signs in on a recovery code and spends it', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId);
    const holder = await challengedBrowser(services, ownerId);

    await services.login.verify(
      { recoveryCode: RECOVERY_CODE },
      holder.request,
      holder.response,
    );

    expect(services.signIn.accountIds).toEqual([ownerId]);
    expect((await harness().secondFactor(ownerId)).recoveryCodes).toEqual([
      { hash: RECOVERY_HASH, usedAt: NOW },
      { hash: OTHER_RECOVERY_HASH, usedAt: null },
    ]);
    expect(await harness().storedChallenges()).toEqual([]);
  });

  it('counts a wrong code once and keeps the challenge open for the right one', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const { clock } = harness();
    await seedEnabled(harness(), services.crypto, ownerId);
    const holder = await challengedBrowser(services, ownerId);

    expect(
      await refusalOf(
        services.login.verify(
          { code: wrongCode(clock, TOTP_SECRET) },
          holder.request,
          holder.response,
        ),
      ),
    ).toEqual(CODE_INVALID);

    expect(await harness().storedChallenges()).toMatchObject([
      { userId: ownerId, attempts: 1, claimed: false },
    ]);
    expect(services.signIn.accountIds).toEqual([]);
    expect(holder.cookies[CHALLENGE_COOKIE]).toEqual(expect.any(String));

    await services.login.verify(
      { code: codeAt(clock, TOTP_SECRET) },
      holder.request,
      holder.response,
    );
    expect(services.signIn.accountIds).toEqual([ownerId]);
  });

  it('takes the right code after four wrong ones and refuses it after five', async () => {
    const { ownerId, otherId } = fixture();
    const services = twoFactorServices(harness());
    const { clock } = harness();
    await seedEnabled(harness(), services.crypto, ownerId);
    await seedEnabled(harness(), services.crypto, otherId);
    const wrong = { code: wrongCode(clock, TOTP_SECRET) };
    const right = { code: codeAt(clock, TOTP_SECRET) };

    const four = await challengedBrowser(services, ownerId);
    for (let tries = 1; tries < MAX_WRONG_ANSWERS; tries += 1) {
      expect(
        await refusalOf(
          services.login.verify(wrong, four.request, four.response),
        ),
      ).toEqual(CODE_INVALID);
    }
    await services.login.verify(right, four.request, four.response);
    expect(services.signIn.accountIds).toEqual([ownerId]);

    const five = await challengedBrowser(services, otherId);
    for (let tries = 1; tries <= MAX_WRONG_ANSWERS; tries += 1) {
      expect(
        await refusalOf(
          services.login.verify(wrong, five.request, five.response),
        ),
      ).toEqual(CODE_INVALID);
    }
    expect(await harness().storedChallenges()).toEqual([]);
    expect(
      await refusalOf(
        services.login.verify(right, five.request, five.response),
      ),
    ).toEqual(CHALLENGE_INVALID);
    expect(services.signIn.accountIds).toEqual([ownerId]);
    expect((await harness().secondFactor(otherId)).lastUsedStep).toBe(null);
  });

  it('issues one session when two requests answer one challenge at once', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId);
    const holder = await challengedBrowser(services, ownerId);
    const copy = browser(holder.cookies);
    const gate = new RaceGate();
    const restore = holdBefore(harness().challenges, 'claim', () => gate);

    const attempts = [
      outcomeOf(
        services.login.verify(
          { recoveryCode: RECOVERY_CODE },
          holder.request,
          holder.response,
        ),
      ),
      outcomeOf(
        services.login.verify(
          { recoveryCode: 'B2C3D4E5F6' },
          copy.request,
          copy.response,
        ),
      ),
    ];
    await gate.reached(2);
    gate.release();
    const outcomes = await Promise.all(attempts);
    restore();

    expect(outcomes.sort()).toEqual([
      'TWO_FACTOR_CHALLENGE_INVALID',
      'accepted',
    ]);
    expect(services.signIn.accountIds).toEqual([ownerId]);
    const spent = (await harness().secondFactor(ownerId)).recoveryCodes;
    expect(spent.filter((code) => code.usedAt !== null)).toHaveLength(1);
  });

  it('refuses a lapsed challenge whose row is still stored and spends nothing', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    await seedEnabled(harness(), services.crypto, ownerId);
    const holder = await challengedBrowser(services, ownerId);
    const [{ id: challengeId }] = await harness().storedChallenges();
    await harness().alterChallenge(challengeId, { expiresAt: NOW });

    expect(
      await refusalOf(
        services.login.verify(
          { code: codeAt(harness().clock, TOTP_SECRET) },
          holder.request,
          holder.response,
        ),
      ),
    ).toEqual(CHALLENGE_INVALID);

    expect(await harness().storedChallenges()).toMatchObject([
      { id: challengeId, attempts: 0, claimed: false },
    ]);
    expect(services.signIn.accountIds).toEqual([]);
    expect((await harness().secondFactor(ownerId)).lastUsedStep).toBe(null);
  });
}

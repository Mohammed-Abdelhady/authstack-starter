import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { SecondFactorVerifier } from '../services/second-factor-verifiers';
import {
  challengedBrowser,
  codeAt,
  NO_SECOND_FACTOR,
  OTHER_RECOVERY_HASH,
  RECOVERY_HASH,
  refusalOf,
  rejectionOf,
  seedEnabled,
  STEP_AT_TEST_NOW,
  TOTP_SECRET,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
} from './two-factor-contract.harness-spec';

const CHALLENGE_INVALID = {
  code: 'TWO_FACTOR_CHALLENGE_INVALID',
  status: 401,
};
const CODE_INVALID = { code: 'TWO_FACTOR_CODE_INVALID', status: 401 };

/** The second step when the account, the session or the answer is not as expected. */
export function secondStepRefusalCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('answers the same, with the same work, when the account is gone, deactivated or without the factor', async () => {
    const { ownerId, otherId } = fixture();
    const { crypto } = twoFactorServices(harness());
    const thirdId = await harness().seedAccount({
      email: 'third@example.test',
    });
    const fourthId = await harness().seedAccount({
      email: 'fourth@example.test',
    });
    for (const userId of [ownerId, otherId, thirdId, fourthId]) {
      await seedEnabled(harness(), crypto, userId);
    }
    const afterChallenge: Record<string, () => Promise<void>> = {
      [ownerId]: () => harness().removeAccount(ownerId),
      [otherId]: () => harness().setDeleted(otherId, true),
      [thirdId]: () => harness().seedSecondFactor(thirdId, NO_SECOND_FACTOR),
      [fourthId]: () =>
        harness().seedSecondFactor(fourthId, {
          ...NO_SECOND_FACTOR,
          secret: crypto.encrypt(TOTP_SECRET),
        }),
    };

    for (const [userId, change] of Object.entries(afterChallenge)) {
      const services = twoFactorServices(harness());
      const holder = await challengedBrowser(services, userId);
      await change();
      services.storeCalls.length = 0;

      const refused = await refusalOf(
        services.login.verify(
          { code: codeAt(harness().clock, TOTP_SECRET) },
          holder.request,
          holder.response,
        ),
      );

      expect({
        refused,
        work: services.storeCalls,
        signedIn: services.signIn.accountIds,
        cookies: holder.cookies,
        challenges: await harness().storedChallenges(),
      }).toEqual({
        refused: CHALLENGE_INVALID,
        work: [
          'challenges.isAccountId',
          'challenges.claim',
          'accounts.findChallengedAccount',
          'challenges.discard',
        ],
        signedIn: [],
        cookies: {},
        challenges: [],
      });
    }
  });

  it('keeps the challenge and the code spent when the session cannot be issued', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const { clock } = harness();
    await seedEnabled(harness(), services.crypto, ownerId);
    const holder = await challengedBrowser(services, ownerId);
    const outage = new Error('the session could not be issued');
    services.signIn.failure = outage;

    expect(
      await rejectionOf(
        services.login.verify(
          { code: codeAt(clock, TOTP_SECRET) },
          holder.request,
          holder.response,
        ),
      ),
    ).toBe(outage);

    services.signIn.failure = undefined;
    expect(await harness().storedChallenges()).toEqual([]);
    expect((await harness().secondFactor(ownerId)).lastUsedStep).toBe(
      STEP_AT_TEST_NOW,
    );
    expect(services.signIn.accountIds).toEqual([]);
  });

  it('hands another kind of answer to its verifier with the challenged account, and counts its refusal', async () => {
    const { ownerId } = fixture();
    const seen: string[] = [];
    let refuse = true;
    const verifier: SecondFactorVerifier = {
      supports: (dto) => dto.code === undefined,
      verify: (_dto, account) => {
        seen.push(account.id);
        return refuse
          ? Promise.reject(
              new AppException(
                ErrorCode.TWO_FACTOR_CODE_INVALID,
                'refused by the verifier',
                HttpStatus.UNAUTHORIZED,
              ),
            )
          : Promise.resolve();
      },
    };
    const services = twoFactorServices(harness(), [verifier]);
    await seedEnabled(harness(), services.crypto, ownerId);
    const holder = await challengedBrowser(services, ownerId);

    expect(
      await refusalOf(
        services.login.verify({}, holder.request, holder.response),
      ),
    ).toEqual(CODE_INVALID);
    expect(await harness().storedChallenges()).toMatchObject([
      { userId: ownerId, attempts: 1, claimed: false },
    ]);

    refuse = false;
    await services.login.verify({}, holder.request, holder.response);

    expect(seen).toEqual([ownerId, ownerId]);
    expect(services.signIn.accountIds).toEqual([ownerId]);
    expect(await harness().secondFactor(ownerId)).toMatchObject({
      lastUsedStep: null,
      recoveryCodes: [
        { hash: RECOVERY_HASH, usedAt: null },
        { hash: OTHER_RECOVERY_HASH, usedAt: null },
      ],
    });
  });
}

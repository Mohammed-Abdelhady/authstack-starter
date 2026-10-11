import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import {
  browser,
  CHALLENGE_COOKIE,
  CHALLENGE_LIFETIME_MS,
  challengedBrowser,
  MAX_WRONG_ANSWERS,
  refusalOf,
  rejectionOf,
  twoFactorCase,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
} from './two-factor-contract.harness-spec';

const CHALLENGE_INVALID = {
  code: 'TWO_FACTOR_CHALLENGE_INVALID',
  status: 401,
};
const NONCE_RULE = 'two_factor_challenge.nonce_hash';
const NOW_MS = Date.parse('2099-01-01T12:00:00.000Z');
const NONCE_HASH = 'a'.repeat(64);

function at(offsetMs: number): Date {
  return new Date(NOW_MS + offsetMs);
}

function limits(now: Date): { now: Date; maxAttempts: number } {
  return { now, maxAttempts: MAX_WRONG_ANSWERS };
}

/** What the challenge store answers on its own: ownership, uniqueness, clean-up. */
export function challengeStoreCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  twoFactorCase(
    'finds a challenge only under the account it was opened for',
    async () => {
      const { ownerId, otherId } = fixture();
      const { challenges } = harness();
      await harness().seedChallenge({
        nonceHash: NONCE_HASH,
        userId: ownerId,
        expiresAt: at(60_000),
      });
      const asOther = { nonceHash: NONCE_HASH, userId: otherId };

      expect(await challenges.find(asOther)).toBe(null);
      expect(await challenges.claim(asOther, limits(at(0)))).toBe(null);
      expect(
        await challenges.find({ nonceHash: 'b'.repeat(64), userId: ownerId }),
      ).toBe(null);
      expect((await harness().storedChallenges())[0].claimed).toBe(false);
    },
  );

  twoFactorCase(
    'refuses a cookie that is missing or was edited, before anything is read',
    async () => {
      const { ownerId, otherId } = fixture();
      const services = twoFactorServices(harness());
      const holder = await challengedBrowser(services, ownerId);
      const [, signature] = holder.cookies[CHALLENGE_COOKIE].split('.');
      const forged = Buffer.from(
        JSON.stringify({
          sub: otherId,
          nonce: 'anything',
          expiresAt: NOW_MS + CHALLENGE_LIFETIME_MS,
        }),
      ).toString('base64url');
      services.storeCalls.length = 0;

      expect(
        await refusalOf(services.challenge.claim(browser().request)),
      ).toEqual(CHALLENGE_INVALID);
      expect(
        await refusalOf(
          services.challenge.claim(
            browser({ [CHALLENGE_COOKIE]: `${forged}.${signature}` }).request,
          ),
        ),
      ).toEqual(CHALLENGE_INVALID);
      expect(services.storeCalls).toEqual([]);
    },
  );

  twoFactorCase(
    'refuses a nonce that is already stored, by the name of the rule',
    async () => {
      const { ownerId, otherId } = fixture();
      const { challenges } = harness();
      await challenges.open({
        userId: ownerId,
        nonceHash: NONCE_HASH,
        expiresAt: at(60_000),
      });

      const refused = await rejectionOf(
        challenges.open({
          userId: otherId,
          nonceHash: NONCE_HASH,
          expiresAt: at(60_000),
        }),
      );

      expect(refused).toBeInstanceOf(UniqueConflictError);
      expect(refused).toMatchObject({ constraint: NONCE_RULE });
      expect(await harness().storedChallenges()).toMatchObject([
        { userId: ownerId, nonceHash: NONCE_HASH },
      ]);
    },
  );
}

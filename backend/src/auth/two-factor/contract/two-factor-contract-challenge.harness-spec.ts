import { createHash } from 'node:crypto';
import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import {
  browser,
  CHALLENGE_COOKIE,
  CHALLENGE_LIFETIME_MS,
  challengedBrowser,
  MAX_WRONG_ANSWERS,
  outcomeOf,
  refusalOf,
  TwoFactorContractHarness,
  TwoFactorFixture,
  TwoFactorHarnessSource,
  twoFactorServices,
} from './two-factor-contract.harness-spec';

const CHALLENGE_INVALID = {
  code: 'TWO_FACTOR_CHALLENGE_INVALID',
  status: 401,
};
const NOW_MS = Date.parse('2099-01-01T12:00:00.000Z');
const NONCE_HASH = 'a'.repeat(64);

function at(offsetMs: number): Date {
  return new Date(NOW_MS + offsetMs);
}

function limits(now: Date): { now: Date; maxAttempts: number } {
  return { now, maxAttempts: MAX_WRONG_ANSWERS };
}

async function onlyChallengeId(
  harness: TwoFactorContractHarness,
): Promise<string> {
  const stored = await harness.storedChallenges();
  if (stored.length !== 1) {
    throw new Error(`expected one stored challenge, found ${stored.length}`);
  }
  return stored[0].id;
}

/** The held sign-in: opened once, claimed by one request, bounded by time and tries. */
export function challengeCases(
  harness: TwoFactorHarnessSource,
  fixture: () => TwoFactorFixture,
): void {
  it('opens a challenge under the hash of its nonce and first factor with five minutes to live', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());

    const holder = await challengedBrowser(services, ownerId);

    const token = holder.cookies[CHALLENGE_COOKIE];
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
    );
    expect(payload).toEqual({
      sub: ownerId,
      nonce: expect.stringMatching(/^[\w-]{43}$/) as string,
      expiresAt: NOW_MS + CHALLENGE_LIFETIME_MS,
      firstFactor: 'password',
    });
    const { nonce } = payload as { nonce: string };
    const stored = await harness().storedChallenges();
    expect(stored).toEqual([
      {
        id: stored[0].id,
        userId: ownerId,
        nonceHash: createHash('sha256')
          .update(`${nonce}.password`)
          .digest('hex'),
        attempts: 0,
        claimed: false,
        expiresAt: at(CHALLENGE_LIFETIME_MS),
      },
    ]);
  });

  it('claims an open challenge for one request and refuses the same cookie again', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const holder = await challengedBrowser(services, ownerId);
    const challengeId = await onlyChallengeId(harness());

    expect(await services.challenge.claim(holder.request)).toEqual({
      challengeId,
      userId: ownerId,
      firstFactor: 'password',
    });
    expect((await harness().storedChallenges())[0].claimed).toBe(true);
    expect(await refusalOf(services.challenge.claim(holder.request))).toEqual(
      CHALLENGE_INVALID,
    );
  });

  it('lets one of two simultaneous requests claim a challenge', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const holder = await challengedBrowser(services, ownerId);
    const copy = browser(holder.cookies);
    const gate = new RaceGate();
    const restore = holdBefore(harness().challenges, 'claim', () => gate);

    const attempts = [
      outcomeOf(services.challenge.claim(holder.request)),
      outcomeOf(services.challenge.claim(copy.request)),
    ];
    await gate.reached(2);
    gate.release();
    const outcomes = await Promise.all(attempts);
    restore();

    expect(outcomes.sort()).toEqual([
      'TWO_FACTOR_CHALLENGE_INVALID',
      'accepted',
    ]);
  });

  it('refuses a challenge at its expiry though its row is stored, and takes it a millisecond earlier', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const { clock } = harness();
    const holder = await challengedBrowser(services, ownerId);
    const challengeId = await onlyChallengeId(harness());
    // The row lapses long before the cookie, so only the stored expiry decides.
    await harness().alterChallenge(challengeId, { expiresAt: at(1000) });

    clock.set(at(1000));
    expect(await refusalOf(services.challenge.claim(holder.request))).toEqual(
      CHALLENGE_INVALID,
    );
    expect(await harness().storedChallenges()).toMatchObject([
      { id: challengeId, claimed: false, expiresAt: at(1000) },
    ]);

    clock.set(at(999));
    expect(await services.challenge.claim(holder.request)).toEqual({
      challengeId,
      userId: ownerId,
      firstFactor: 'password',
    });
  });

  it('compares the expiry and the attempts it is given, at the store', async () => {
    const { ownerId } = fixture();
    const { challenges } = harness();
    const key = { nonceHash: NONCE_HASH, userId: ownerId };
    const challengeId = await harness().seedChallenge({
      ...key,
      attempts: MAX_WRONG_ANSWERS - 1,
      expiresAt: at(60_000),
    });

    expect(await challenges.claim(key, limits(at(60_000)))).toBe(null);
    expect(await challenges.claim(key, limits(at(60_001)))).toBe(null);
    expect(
      await challenges.claim(key, {
        now: at(0),
        maxAttempts: MAX_WRONG_ANSWERS - 1,
      }),
    ).toBe(null);
    expect((await harness().storedChallenges())[0].claimed).toBe(false);

    expect(await challenges.claim(key, limits(at(59_999)))).toEqual({
      id: challengeId,
      userId: ownerId,
      attempts: MAX_WRONG_ANSWERS - 1,
      expiresAt: at(60_000),
    });
    expect(await challenges.claim(key, limits(at(0)))).toBe(null);
  });

  it('refuses a challenge that is out of attempts though its row is stored', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const holder = await challengedBrowser(services, ownerId);
    const challengeId = await onlyChallengeId(harness());
    await harness().alterChallenge(challengeId, {
      attempts: MAX_WRONG_ANSWERS,
    });

    expect(await refusalOf(services.challenge.claim(holder.request))).toEqual(
      CHALLENGE_INVALID,
    );
    expect(await harness().storedChallenges()).toMatchObject([
      { id: challengeId, attempts: MAX_WRONG_ANSWERS, claimed: false },
    ]);
  });

  it('reads an open challenge and drops one that lapsed or ran out of attempts', async () => {
    const { ownerId, otherId } = fixture();
    const services = twoFactorServices(harness());
    const lapsing = await challengedBrowser(services, ownerId);
    const lapsingId = await onlyChallengeId(harness());

    expect(await services.challenge.read(lapsing.request)).toEqual({
      challengeId: lapsingId,
      userId: ownerId,
      firstFactor: 'password',
    });
    await harness().alterChallenge(lapsingId, { expiresAt: at(0) });
    expect(await refusalOf(services.challenge.read(lapsing.request))).toEqual(
      CHALLENGE_INVALID,
    );
    expect(await harness().storedChallenges()).toEqual([]);

    const exhausted = await challengedBrowser(services, otherId);
    const exhaustedId = await onlyChallengeId(harness());
    await harness().alterChallenge(exhaustedId, {
      attempts: MAX_WRONG_ANSWERS,
    });
    expect(await refusalOf(services.challenge.read(exhausted.request))).toEqual(
      CHALLENGE_INVALID,
    );
    expect(await harness().storedChallenges()).toEqual([]);
  });

  it('counts a wrong answer once, releases the claim, and drops the challenge on the fifth', async () => {
    const { ownerId } = fixture();
    const services = twoFactorServices(harness());
    const holder = await challengedBrowser(services, ownerId);
    const challengeId = await onlyChallengeId(harness());
    await services.challenge.claim(holder.request);

    await services.challenge.registerFailure(challengeId);

    expect(await harness().storedChallenges()).toMatchObject([
      { id: challengeId, attempts: 1, claimed: false },
    ]);
    for (let wrong = 2; wrong < MAX_WRONG_ANSWERS; wrong += 1) {
      await services.challenge.claim(holder.request);
      await services.challenge.registerFailure(challengeId);
    }
    expect(await harness().storedChallenges()).toMatchObject([
      { id: challengeId, attempts: MAX_WRONG_ANSWERS - 1, claimed: false },
    ]);

    await services.challenge.claim(holder.request);
    await services.challenge.registerFailure(challengeId);

    expect(await harness().storedChallenges()).toEqual([]);
    // Counting against a challenge that is gone stores nothing.
    await services.challenge.registerFailure(challengeId);
    expect(await harness().challenges.countFailure(challengeId)).toBe(null);
    expect(await harness().storedChallenges()).toEqual([]);
  });
}

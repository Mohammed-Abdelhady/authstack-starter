import { ConfigService } from '@nestjs/config';
import { FrozenClock, TEST_NOW } from '../../../../../test/utils/frozen-clock';
import {
  RevocableProviders,
  type RevocableProvider,
  type RevocationAttempt,
} from '../revocable-provider';
import { MemoryProviderTokenStore } from '../testing/provider-token-memory.harness-spec';
import { ProviderRevocationRunner } from './provider-revocation-runner';
import { ProviderRevocations } from './provider-revocations';
import { ProviderTokenCrypto } from './provider-token-crypto';
import { InPlaceRunner } from '../../../../user/erasure/testing/erasure-memory.harness-spec';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const OWNER = {
  provider: 'apple',
  subject: 'apple-sub-1',
  clientId: 'com.example.app',
};

/** Apple's revocation endpoint, answering what the case scripts. */
class ScriptedApple implements RevocableProvider {
  readonly revoked: { token: string; clientId: string }[] = [];
  answer: RevocationAttempt | Error = { kind: 'revoked' };

  revokeProviderToken(request: { token: string; clientId: string }) {
    this.revoked.push(request);
    return this.answer instanceof Error
      ? Promise.reject(this.answer)
      : Promise.resolve(this.answer);
  }
}

class OneProvider extends RevocableProviders {
  constructor(private readonly provider: RevocableProvider) {
    super();
  }

  find(providerId: string): RevocableProvider | undefined {
    return providerId === OWNER.provider ? this.provider : undefined;
  }
}

/** An account with a kept Apple token, unlinked now: one pending job. */
async function setUp() {
  const clock = new FrozenClock(TEST_NOW);
  const store = new MemoryProviderTokenStore();
  const crypto = new ProviderTokenCrypto(
    new ConfigService({ providerTokens: { encryptionKey: 'k'.repeat(32) } }),
  );
  const keep = (subject: string, token: string) => {
    const owner = { ...OWNER, subject };
    return store.keep({
      ...owner,
      sealed: crypto.seal(token, owner),
      storedAt: clock.now(),
      checkAfter: new Date(clock.now().getTime() + DAY),
    });
  };
  await keep(OWNER.subject, 'refresh-1');
  const revocations = new ProviderRevocations(store, clock);
  await new InPlaceRunner().run((unitOfWork) =>
    revocations.enqueueIn(unitOfWork, {
      userId: 'account-1',
      identities: [{ provider: 'apple', providerId: OWNER.subject }],
      reason: 'unlink',
    }),
  );
  const apple = new ScriptedApple();
  const runner = new ProviderRevocationRunner(
    store,
    crypto,
    new OneProvider(apple),
    clock,
    new InPlaceRunner(),
    revocations,
  );
  return { clock, store, apple, runner, keep };
}

describe('the provider revocation runner', () => {
  it('moves the kept token into the job, revokes it with its client id, then clears it', async () => {
    const { store, apple, runner } = await setUp();
    expect(store.tokens).toEqual([]);

    await runner.runOnce();

    expect(apple.revoked).toEqual([
      { token: 'refresh-1', clientId: 'com.example.app' },
    ]);
    expect(store.jobs).toMatchObject([
      { state: 'revoked', outcome: 'revoked', sealed: null },
    ]);
  });

  it('keeps the token through failures, waits longer each time, and flags the job at the fifth', async () => {
    const { clock, store, apple, runner } = await setUp();
    apple.answer = new Error('appleid.apple.com unreachable');
    const waits: number[] = [];

    for (let failure = 1; failure <= 5; failure += 1) {
      await runner.runOnce();
      const job = store.jobs[0];
      const next = job?.nextAttemptAt?.getTime() ?? 0;
      waits.push((next - clock.now().getTime()) / MINUTE);
      if (failure === 4) expect(job?.flaggedAt).toBeNull();
      clock.set(new Date(next));
    }

    expect(waits).toEqual([5, 10, 20, 40, 80]);
    expect(store.jobs).toMatchObject([
      {
        state: 'pending',
        attempts: 5,
        failureCode: 'request_failed',
        flaggedAt: new Date(TEST_NOW.getTime() + (5 + 10 + 20 + 40) * MINUTE),
      },
    ]);
    expect(store.jobs[0]?.sealed).not.toBeNull();
  });

  it("revokes a token no account claimed a day after it was kept, and keeps a linked identity's", async () => {
    const { clock, store, apple, runner, keep } = await setUp();
    await runner.runOnce();
    await keep('refused-sign-up', 'refresh-2');
    await keep('signed-in', 'refresh-3');
    store.linked.add('apple:signed-in');

    clock.advance(DAY - MINUTE);
    await runner.runOnce();
    const beforeTheDay = apple.revoked.map((call) => call.token);
    clock.advance(MINUTE);
    await runner.runOnce();

    expect(beforeTheDay).toEqual(['refresh-1']);
    expect(apple.revoked.map((call) => call.token)).toEqual([
      'refresh-1',
      'refresh-2',
    ]);
    expect(store.jobs[1]).toMatchObject({
      subject: 'refused-sign-up',
      userId: null,
      reason: 'unclaimed',
      state: 'revoked',
    });
    expect(store.tokens.map((kept) => kept.subject)).toEqual(['signed-in']);
  });

  it('records a token no configured key reads as unreadable, and leaves it for staff', async () => {
    const { store, runner } = await setUp();
    const job = store.jobs[0];
    if (job?.sealed) job.sealed = { ...job.sealed, keyId: 'retired-key' };

    await runner.runOnce();

    expect(store.jobs).toMatchObject([
      { state: 'pending', attempts: 1, failureCode: 'token_unreadable' },
    ]);
  });
});

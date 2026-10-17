import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
// feature:oauth-core:start
import { ProviderRevocations } from '../../../auth/oauth/provider-tokens/services/provider-revocations';
import { MemoryProviderTokenStore } from '../../../auth/oauth/provider-tokens/testing/provider-token-memory.harness-spec';
// feature:oauth-core:end
import {
  InPlaceRunner,
  MemoryAccountEraser,
  MemoryAddressLedger,
  MemoryErasureJobStore,
  MemoryErasureWorld,
  RecordingHook,
} from '../testing/erasure-memory.harness-spec';
import { ErasureSettings } from './erasure-settings';
import { ErasureWorker } from './erasure-worker';

const MINUTE = 60_000;
const DAY = 86_400_000;
const ACCOUNT = 'account-1';
const PENDING = 'new@example.com';

function setUp(options: { graceDays?: number; inTransaction?: boolean } = {}) {
  const world = new MemoryErasureWorld();
  world.accounts.set(ACCOUNT, {
    isDeleted: true,
    eraseAfter: new Date(TEST_NOW.getTime() - MINUTE),
    address: 'ada@example.com',
    pendingAddress: PENDING,
    identities: [{ provider: 'apple', providerId: 'apple-sub-1' }],
  });
  const ledger = new MemoryAddressLedger();
  ledger.claims.set(PENDING, {
    owner: ACCOUNT,
    lapsesAt: new Date(TEST_NOW.getTime() + DAY),
  });
  const clock = new FrozenClock(TEST_NOW);
  const hook = new RecordingHook(options.inTransaction ?? false);
  const eraser = new MemoryAccountEraser(world);
  const tokens = new MemoryProviderTokenStore(); // feature:oauth-core
  const config = new ConfigService(
    'graceDays' in options
      ? { account: { eraseGraceDays: options.graceDays } }
      : { account: { eraseGraceDays: 30 } },
  );
  const worker = new ErasureWorker(
    new MemoryErasureJobStore(world),
    eraser,
    hook,
    new InPlaceRunner(),
    clock,
    new ErasureSettings(config),
    ledger,
    new ProviderRevocations(tokens, clock), // feature:oauth-core
  );
  return {
    world,
    clock,
    hook,
    eraser,
    ledger,
    worker,
    tokens, // feature:oauth-core
  };
}

describe('the erasure worker', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does nothing while erasure is off', async () => {
    const { world, hook, eraser, worker } = setUp({ graceDays: undefined });

    await worker.runOnce();

    expect({
      hookCalls: hook.calls.length,
      erased: eraser.erased,
      job: world.jobOf(ACCOUNT),
    }).toEqual({ hookCalls: 0, erased: [], job: undefined });
  });

  it('calls the hook once outside the removal, then removes the account and finishes the job', async () => {
    const { world, hook, eraser, worker } = setUp();

    await worker.runOnce();

    expect(hook.calls).toEqual([
      {
        subject: {
          accountId: ACCOUNT,
          addresses: ['ada@example.com', PENDING],
        },
        inTransaction: false,
      },
    ]);
    expect(eraser.removals).toMatchObject([
      { accountId: ACCOUNT, addresses: ['ada@example.com', PENDING] },
    ]);
    expect(world.jobOf(ACCOUNT)).toMatchObject({
      step: 'erased',
      erasedAt: TEST_NOW,
    });
  });

  it("matches nothing by a pending address another account claimed once the account's claim lapsed", async () => {
    const { hook, eraser, ledger, worker } = setUp();
    ledger.claims.set(PENDING, {
      owner: 'account-2',
      lapsesAt: new Date(TEST_NOW.getTime() + DAY),
    });

    await worker.runOnce();

    expect(hook.calls.map((call) => call.subject.addresses)).toEqual([
      ['ada@example.com'],
    ]);
    expect(eraser.removals.map((removal) => removal.addresses)).toEqual([
      ['ada@example.com'],
    ]);
  });

  it('erases nothing when the hook fails, and waits longer before each next try', async () => {
    const { world, clock, hook, eraser, worker } = setUp();
    hook.failure = new Error('host store down');

    await worker.runOnce();
    const first = { ...world.jobOf(ACCOUNT) };
    clock.advance(MINUTE);
    await worker.runOnce();
    const second = { ...world.jobOf(ACCOUNT) };

    expect(eraser.erased).toEqual([]);
    expect(world.accounts.has(ACCOUNT)).toBe(true);
    expect([first, second]).toMatchObject([
      {
        step: 'erasing',
        attempts: 1,
        failureCode: 'hook_failed',
        nextAttemptAt: new Date(TEST_NOW.getTime() + MINUTE),
      },
      {
        step: 'erasing',
        attempts: 2,
        failureCode: 'hook_failed',
        nextAttemptAt: new Date(TEST_NOW.getTime() + MINUTE + 2 * MINUTE),
      },
    ]);
  });

  it('keeps no trace of a secret a failing hook put in its message', async () => {
    const { world, hook, worker } = setUp();
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...parts: unknown[]) => {
          lines.push(parts.map(String).join(' '));
        });
    }
    hook.failure = new Error('refresh_token=sk_live_secret_token');

    await worker.runOnce();

    expect(world.jobOf(ACCOUNT)?.failureCode).toBe('hook_failed');
    expect(lines.join('\n')).not.toContain('sk_live_secret_token');
  });

  it('resumes a job whose worker died after the hook without calling it again', async () => {
    const { world, hook, eraser, worker } = setUp();
    const job = world.newJob(ACCOUNT, {
      owner: 'a worker that died',
      now: new Date(TEST_NOW.getTime() - DAY),
      until: new Date(TEST_NOW.getTime() - MINUTE),
    });
    job.step = 'hook_done';

    await worker.runOnce();

    expect({ hookCalls: hook.calls.length, erased: eraser.erased }).toEqual({
      hookCalls: 0,
      erased: [ACCOUNT],
    });
    expect(world.jobOf(ACCOUNT)?.step).toBe('erased');
  });

  it('erases nothing and withdraws the job when a restore lands after step 1', async () => {
    const { world, hook, eraser, worker } = setUp();
    // A restore that did not take the erasure lock commits while the hook runs.
    jest.spyOn(hook, 'erase').mockImplementationOnce(() => {
      const account = world.accounts.get(ACCOUNT);
      if (account)
        Object.assign(account, { isDeleted: false, eraseAfter: null });
      return Promise.resolve();
    });

    await worker.runOnce();

    expect(eraser.erased).toEqual([]);
    expect(world.accounts.get(ACCOUNT)?.isDeleted).toBe(false);
    expect(world.jobOf(ACCOUNT)).toBeUndefined();
  });

  it('tells an in-transaction hook only the addresses step 3 still holds', async () => {
    const { hook, eraser, ledger, worker } = setUp({ inTransaction: true });
    const holds = ledger.holdsLiveClaim.bind(ledger);
    // Step 1 sees the live claim on the pending address; another account takes it before step 3.
    jest
      .spyOn(ledger, 'holdsLiveClaim')
      .mockImplementationOnce(async (unitOfWork, input) => {
        const live = await holds(unitOfWork, input);
        ledger.claims.set(PENDING, {
          owner: 'account-2',
          lapsesAt: new Date(TEST_NOW.getTime() + DAY),
        });
        return live;
      });

    await worker.runOnce();

    expect(hook.calls).toEqual([
      {
        subject: { accountId: ACCOUNT, addresses: ['ada@example.com'] },
        inTransaction: true,
      },
    ]);
    expect(eraser.removals.map((removal) => removal.addresses)).toEqual([
      ['ada@example.com'],
    ]);
  });

  it('calls an in-transaction hook inside the removal, and a failure there erases nothing', async () => {
    const { world, hook, eraser, worker } = setUp({ inTransaction: true });
    hook.failure = new Error('host table locked');

    await worker.runOnce();

    expect(hook.calls.map((call) => call.inTransaction)).toEqual([true]);
    expect(eraser.erased).toEqual([]);
    expect(world.jobOf(ACCOUNT)).toMatchObject({
      step: 'erasing',
      failureCode: 'hook_failed',
    });
  });

  // feature:oauth-core:start
  it("writes a revocation job for the account's Apple identity, closed at once when no token was kept", async () => {
    const { worker, tokens } = setUp();

    await worker.runOnce();

    expect(tokens.jobs).toMatchObject([
      {
        provider: 'apple',
        subject: 'apple-sub-1',
        userId: ACCOUNT,
        reason: 'erasure',
        state: 'closed',
        outcome: 'no_token',
      },
    ]);
  });
  // feature:oauth-core:end
});

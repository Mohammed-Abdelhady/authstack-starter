import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import type { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import {
  REVOCATION_FAILURE,
  REVOCATION_OUTCOME,
  REVOCATION_REASON,
} from './constants/provider-tokens.constants';
import type { ProviderTokenStore } from './stores/provider-token.store';
import type {
  KeptProviderToken,
  NewRevocationJob,
  SealedToken,
} from './types/provider-tokens';
import {
  describeUnclaimedTokens,
  IDENTITY,
  SEALED,
  token,
} from './provider-tokens.contract-unclaimed.harness-spec';

export interface ProviderTokensHarness {
  store: ProviderTokenStore;
  clock: FrozenClock;
  userId: string;
  unitOfWork: UnitOfWorkRunner;
  reset: () => Promise<void>;
  close: () => Promise<void>;
  checkSetup: () => Promise<void>;
  cleanUp: () => Promise<void>;
  /** Links an Apple identity with this subject to a new account. */
  link: (subject: string) => Promise<void>;
  tokenRows: () => Promise<KeptProviderToken[]>;
  jobRows: () => Promise<
    {
      id: string;
      subject: string;
      clientId: string | null;
      state: string;
      outcome: string | null;
      attempts: number;
      failureCode: string | null;
      flaggedAt: Date | null;
      nextAttemptAt: Date | null;
      leaseUntil: Date | null;
      settledAt: Date | null;
      sealed: SealedToken | null;
      purgeAfter: Date;
    }[]
  >;
}

const LEASE_MS = 60_000;
const RETRY_MS = 300_000;
const PURGE_MS = 2_592_000_000;

export function describeProviderTokensContract(
  name: string,
  boot: () => Promise<ProviderTokensHarness>,
  timeouts: Record<'bootMs' | 'teardownMs' | 'resetMs', number>,
  retention = false,
): void {
  describe(`${name} provider token store`, () => {
    let harness: ProviderTokensHarness;
    beforeAll(async () => {
      harness = await boot();
    }, timeouts.bootMs);
    afterAll(async () => {
      await harness?.close();
    }, timeouts.teardownMs);
    beforeEach(async () => {
      harness.clock.set(TEST_NOW);
      await harness.reset();
    }, timeouts.resetMs);

    describeUnclaimedTokens(() => harness);

    function job(overrides: Partial<NewRevocationJob> = {}): NewRevocationJob {
      return {
        ...IDENTITY,
        clientId: 'web',
        userId: harness.userId,
        reason: REVOCATION_REASON.ERASURE,
        sealed: SEALED,
        createdAt: TEST_NOW,
        purgeAfter: new Date(TEST_NOW.getTime() + PURGE_MS),
        ...overrides,
      };
    }

    function addJobs(jobs: NewRevocationJob[]) {
      return harness.unitOfWork.run((work) =>
        harness.store.addJobsIn(work, jobs),
      );
    }

    function claim(limit = 10) {
      return harness.store.claimDue(
        harness.clock.now(),
        limit,
        new Date(harness.clock.now().getTime() + LEASE_MS),
      );
    }

    async function pendingId(): Promise<string> {
      await addJobs([job()]);
      const [claimed] = await claim(1);
      if (!claimed) throw new Error('No pending token was claimed');
      return claimed.id;
    }

    it('has the identity uniqueness and revocation indexes', async () => {
      await harness.checkSetup();
    });

    it('replaces a kept token for the same identity and client', async () => {
      await harness.store.keep(token('web'));
      await harness.store.keep({
        ...token('web'),
        sealed: { ...SEALED, ciphertext: 'new-ciphertext' },
        storedAt: new Date(TEST_NOW.getTime() + 1),
      });
      expect(await harness.tokenRows()).toEqual([
        {
          provider: 'apple',
          subject: 'mine',
          clientId: 'web',
          sealed: {
            ciphertext: 'new-ciphertext',
            iv: 'iv',
            tag: 'tag',
            keyId: 'key-id',
          },
          storedAt: new Date(TEST_NOW.getTime() + 1),
        },
      ]);
    });

    it('takes every client token of one identity and leaves another identity', async () => {
      await harness.store.keep(token('web'));
      await harness.store.keep(token('mobile'));
      await harness.store.keep(token('web', 'theirs'));
      const taken = await harness.unitOfWork.run(async (work) => {
        const found = await harness.store.takeTokensIn(work, IDENTITY);
        await harness.store.addJobsIn(
          work,
          found.map((kept) =>
            job({ clientId: kept.clientId, sealed: kept.sealed }),
          ),
        );
        return found;
      });
      expect(
        taken.sort((left, right) =>
          left.clientId.localeCompare(right.clientId),
        ),
      ).toEqual([
        {
          provider: 'apple',
          subject: 'mine',
          clientId: 'mobile',
          sealed: SEALED,
          storedAt: TEST_NOW,
        },
        {
          provider: 'apple',
          subject: 'mine',
          clientId: 'web',
          sealed: SEALED,
          storedAt: TEST_NOW,
        },
      ]);
      expect(await harness.tokenRows()).toEqual([
        {
          provider: 'apple',
          subject: 'theirs',
          clientId: 'web',
          sealed: SEALED,
          storedAt: TEST_NOW,
        },
      ]);
      expect((await claim()).map(({ clientId }) => clientId).sort()).toEqual([
        'mobile',
        'web',
      ]);
    });

    it('closes a job without a token and leases only pending due jobs', async () => {
      await addJobs([
        job(),
        job({ subject: 'missing', clientId: null, sealed: undefined }),
        job({ subject: 'future', createdAt: new Date(TEST_NOW.getTime() + 1) }),
      ]);
      expect(await claim()).toEqual([
        {
          id: expect.any(String),
          provider: 'apple',
          subject: 'mine',
          clientId: 'web',
          sealed: SEALED,
          attempts: 0,
        },
      ]);
      const rows = await harness.jobRows();
      expect(rows.find(({ subject }) => subject === 'mine')).toMatchObject({
        state: 'pending',
        outcome: null,
        sealed: SEALED,
        leaseUntil: new Date(TEST_NOW.getTime() + LEASE_MS),
      });
      expect(rows.find(({ subject }) => subject === 'missing')).toMatchObject({
        state: 'closed',
        outcome: 'no_token',
        sealed: null,
        nextAttemptAt: null,
        settledAt: TEST_NOW,
        leaseUntil: null,
      });
      expect(await claim()).toEqual([]);
    });

    it('counts failures, waits until retry and keeps the first flag time', async () => {
      const id = await pendingId();
      const retryAt = new Date(TEST_NOW.getTime() + RETRY_MS);
      await harness.store.markFailed(id, {
        code: REVOCATION_FAILURE.REQUEST_FAILED,
        at: TEST_NOW,
        nextAttemptAt: retryAt,
        flag: false,
      });
      expect((await harness.jobRows())[0]).toMatchObject({
        attempts: 1,
        failureCode: 'request_failed',
        nextAttemptAt: retryAt,
        leaseUntil: null,
        flaggedAt: null,
      });
      harness.clock.advance(RETRY_MS - 1);
      expect(await claim()).toEqual([]);
      harness.clock.advance(1);
      expect(await claim()).toEqual([
        {
          id,
          provider: 'apple',
          subject: 'mine',
          clientId: 'web',
          sealed: SEALED,
          attempts: 1,
        },
      ]);
      await harness.store.markFailed(id, {
        code: REVOCATION_FAILURE.PROVIDER_REFUSED,
        at: retryAt,
        nextAttemptAt: retryAt,
        flag: true,
      });
      harness.clock.advance(1);
      await harness.store.markFailed(id, {
        code: REVOCATION_FAILURE.PROVIDER_UNAVAILABLE,
        at: harness.clock.now(),
        nextAttemptAt: harness.clock.now(),
        flag: true,
      });
      expect((await harness.jobRows())[0]).toMatchObject({
        attempts: 3,
        failureCode: 'provider_unavailable',
        flaggedAt: retryAt,
        leaseUntil: null,
      });
    });

    it('settles once, clears the token and refuses malformed ids', async () => {
      const id = await pendingId();
      expect(
        await harness.store.settle(id, REVOCATION_OUTCOME.REVOKED, TEST_NOW),
      ).toBe(true);
      expect((await harness.jobRows())[0]).toMatchObject({
        state: 'revoked',
        outcome: 'revoked',
        sealed: null,
        nextAttemptAt: null,
        leaseUntil: null,
        settledAt: TEST_NOW,
      });
      expect(
        await harness.store.settle(id, REVOCATION_OUTCOME.REVOKED, TEST_NOW),
      ).toBe(false);
      expect(
        await harness.store.settle(
          'malformed',
          REVOCATION_OUTCOME.REVOKED,
          TEST_NOW,
        ),
      ).toBe(false);
      expect(await claim()).toEqual([]);
    });

    it('lists flagged pending jobs only, newest flag first', async () => {
      await addJobs([
        job(),
        job({ subject: 'new' }),
        job({ subject: 'closed' }),
        job({ subject: 'unflagged' }),
      ]);
      const rows = await harness.jobRows();
      for (const row of rows) {
        if (row.subject === 'unflagged') continue;
        await harness.store.markFailed(row.id, {
          code: REVOCATION_FAILURE.REQUEST_FAILED,
          at: new Date(TEST_NOW.getTime() + (row.subject === 'new' ? 1 : 0)),
          nextAttemptAt: TEST_NOW,
          flag: true,
        });
        if (row.subject === 'closed')
          await harness.store.settle(
            row.id,
            REVOCATION_OUTCOME.CLOSED_BY_STAFF,
            TEST_NOW,
          );
      }
      const flagged = await harness.store.listFlagged(10);
      expect(flagged.map(({ flaggedAt }) => flaggedAt)).toEqual([
        new Date(TEST_NOW.getTime() + 1),
        TEST_NOW,
      ]);
      expect(flagged.map(({ state }) => state)).toEqual(['pending', 'pending']);
      expect(
        (await harness.store.listFlagged(1)).map(({ flaggedAt }) => flaggedAt),
      ).toEqual([new Date(TEST_NOW.getTime() + 1)]);
    });

    if (retention) {
      it('purges revocation jobs at the retention deadline', async () => {
        await addJobs([job()]);
        harness.clock.advance(PURGE_MS - 1);
        await harness.cleanUp();
        expect(await harness.jobRows()).toHaveLength(1);
        harness.clock.advance(1);
        await harness.cleanUp();
        expect(await harness.jobRows()).toEqual([]);
      });
    }
  });
}

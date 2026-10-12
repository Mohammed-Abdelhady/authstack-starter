import { getModelToken } from '@nestjs/mongoose';
import type { Request } from 'express';
import { Model } from 'mongoose';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  BROWSER_PROOF_TTL_MS,
  browserProofCookieName,
} from '../../constants/browser-proof';
import { WEB_CLIENT_ID } from '../../constants/client-ids';
import {
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../../constants/session-policy';
import {
  BrowserProof,
  BrowserProofDocument,
} from './schemas/browser-proof.schema';
import { BrowserProofStore } from '../../proofs/browser-proof.store';
import { BrowserProofService } from '../../services/browser-proof.service';
import { hashToken, randomSecret } from '../../utils/hashing/token-hash';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../../../test/utils/session-authority-harness';
import { RaceBarrier, holdBefore } from '../../../../test/utils/race-gate';

describe('browser proof single use race', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;
  let proofs: Model<BrowserProofDocument>;
  let service: BrowserProofService;
  let store: BrowserProofStore;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    const clock = new FrozenClock(TEST_NOW);
    harness = await bootSessionAuthority(
      mongo.uri('browser_proof_concurrency'),
      clock,
    );
    proofs = harness.app.get<Model<BrowserProofDocument>>(
      getModelToken(BrowserProof.name),
    );
    service = harness.app.get(BrowserProofService);
    store = harness.app.get(BrowserProofStore);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (harness) {
      await harness.app.close();
    }
    if (mongo) {
      await mongo.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    harness.clock.set(TEST_NOW);
    await proofs.deleteMany({});
    await harness.applications.updateMany(
      { clientId: WEB_CLIENT_ID, environment: 'test' },
      {
        $set: {
          enabled: true,
          sessionVersion: 0,
          'policy.absoluteLifetimeMs': WEB_ABSOLUTE_LIFETIME_MS,
          'policy.idleLifetimeMs': WEB_IDLE_LIFETIME_MS,
        },
      },
    );
  });

  it('accepts exactly one of two uses that both read the proof unspent', async () => {
    const proofId = randomSecret();
    const presented = randomSecret();
    await proofs.create({
      proofIdHash: hashToken(proofId),
      tokenHash: hashToken(presented),
      expiresAt: new Date(TEST_NOW.getTime() + BROWSER_PROOF_TTL_MS),
      spent: false,
    });
    const request = {
      cookies: { [browserProofCookieName(process.env.NODE_ENV)]: proofId },
    } as Request;

    // Both consumes read the unspent proof before either writes: each is
    // held at the store's guarded claim, after its read and its comparison.
    const barrier = new RaceBarrier();
    const firstSpend = barrier.point('first-spend');
    const secondSpend = barrier.point('second-spend');
    const restore = holdBefore(store, 'claimBrowserProof', (call) =>
      call === 0 ? firstSpend : secondSpend,
    );

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    let results: PromiseSettledResult<void>[] | undefined;
    try {
      first = service.consume(request, presented);
      await firstSpend.reached(1);
      second = service.consume(request, presented);
      await secondSpend.reached(1);

      // Order the writes: the first spends, then the second is let go.
      firstSpend.release();
      await first;
      harness.clock.advance(1000);
      secondSpend.release();
      results = await Promise.allSettled([first, second]);
    } finally {
      firstSpend.release();
      secondSpend.release();
      restore();
    }
    if (!results) {
      throw new Error('browser proof race did not run');
    }

    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((row) => row.status === 'rejected')).toHaveLength(1);
    expect(results.find((row) => row.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: ErrorCode.CSRF_INVALID },
    });
    expect({
      proofCount: await proofs.countDocuments({
        proofIdHash: hashToken(proofId),
      }),
      unspentCount: await proofs.countDocuments({
        proofIdHash: hashToken(proofId),
        spent: false,
      }),
      spent: (await proofs.findOne({ proofIdHash: hashToken(proofId) }))?.spent,
    }).toEqual({ proofCount: 1, unspentCount: 0, spent: true });
  });
});

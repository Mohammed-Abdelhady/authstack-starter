import { UniqueConflictError } from '../../../../src/common/persistence/persistence-errors';
import { RaceGate, holdBefore } from '../../race-gate';
import {
  CASE_TIMEOUT_MS,
  HarnessSource,
  HASH_A,
  HASH_B,
  HASH_C,
  NOW,
  ONE_MS_AFTER,
  ONE_MS_BEFORE,
  rejectionOf,
  TOKEN_HASH,
} from './proofs-events-contract-support';

/** The proof store: one guarded claim, with an outcome made for it. */
export function proofStoreCases(harness: HarnessSource): void {
  const seed = (proofIdHash: string, expiresAt: Date, spent = false) =>
    harness().seedProof({
      proofIdHash,
      tokenHash: TOKEN_HASH,
      expiresAt,
      spent,
    });

  it(
    'stores an issued proof unspent and finds it by its id',
    async () => {
      await harness().proofs.issueBrowserProof({
        proofIdHash: HASH_A,
        tokenHash: TOKEN_HASH,
        expiresAt: ONE_MS_AFTER,
      });

      expect({
        found: await harness().proofs.findIssuedBrowserProof(HASH_A),
        unknown: await harness().proofs.findIssuedBrowserProof(HASH_B),
        stored: await harness().storedProof(HASH_A),
      }).toEqual({
        found: { tokenHash: TOKEN_HASH },
        unknown: null,
        stored: {
          tokenHash: TOKEN_HASH,
          expiresAt: ONE_MS_AFTER,
          spent: false,
        },
      });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'refuses a second proof under an id that is already stored',
    async () => {
      await seed(HASH_A, ONE_MS_AFTER);

      const failure = await rejectionOf(
        harness().proofs.issueBrowserProof({
          proofIdHash: HASH_A,
          tokenHash: HASH_C,
          expiresAt: ONE_MS_AFTER,
        }),
      );

      expect({
        conflict: failure instanceof UniqueConflictError,
        constraint:
          failure instanceof UniqueConflictError ? failure.constraint : null,
        stored: (await harness().storedProof(HASH_A))?.tokenHash,
        count: await harness().proofCount(),
      }).toEqual({
        conflict: true,
        constraint: 'browser_proof.proof_id',
        stored: TOKEN_HASH,
        count: 1,
      });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'claims an unspent proof once, and says why every later claim fails',
    async () => {
      await seed(HASH_A, ONE_MS_AFTER);

      const first = await harness().proofs.claimBrowserProof(HASH_A, NOW);
      const second = await harness().proofs.claimBrowserProof(HASH_A, NOW);
      const unknown = await harness().proofs.claimBrowserProof(HASH_B, NOW);

      expect({
        first,
        second,
        unknown,
        spent: (await harness().storedProof(HASH_A))?.spent,
      }).toEqual({
        first: 'claimed',
        second: 'already_claimed',
        unknown: 'not_found',
        spent: true,
      });
    },
    CASE_TIMEOUT_MS,
  );

  it.each([
    ['one millisecond before it expires', ONE_MS_AFTER, 'claimed', true],
    ['at the instant it expires', NOW, 'expired', false],
    ['one millisecond after it expired', ONE_MS_BEFORE, 'expired', false],
  ] as const)(
    'decides expiry itself for a proof claimed %s, though its row is stored',
    async (_, expiresAt, outcome, spent) => {
      await seed(HASH_A, expiresAt);

      const claim = await harness().proofs.claimBrowserProof(HASH_A, NOW);

      expect({
        claim,
        stored: await harness().storedProof(HASH_A),
      }).toEqual({
        claim: outcome,
        stored: { tokenHash: TOKEN_HASH, expiresAt, spent },
      });
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'answers a spent proof as already claimed even after it expired',
    async () => {
      await seed(HASH_A, ONE_MS_BEFORE, true);

      expect(await harness().proofs.claimBrowserProof(HASH_A, NOW)).toBe(
        'already_claimed',
      );
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'tells exactly one of two claims held at the same proof that it claimed',
    async () => {
      await seed(HASH_A, ONE_MS_AFTER);
      const gates = [new RaceGate(), new RaceGate()];
      const restore = holdBefore(
        harness().proofs,
        'claimBrowserProof',
        (call) => gates[call],
      );

      let outcomes: string[] | undefined;
      try {
        const first = harness().proofs.claimBrowserProof(HASH_A, NOW);
        const second = harness().proofs.claimBrowserProof(HASH_A, NOW);
        await Promise.all(gates.map((gate) => gate.reached(1)));
        gates.forEach((gate) => gate.release());
        outcomes = await Promise.all([first, second]);
      } finally {
        gates.forEach((gate) => gate.release());
        restore();
      }

      expect({
        outcomes: [...outcomes].sort(),
        stored: await harness().storedProof(HASH_A),
      }).toEqual({
        outcomes: ['already_claimed', 'claimed'],
        stored: {
          tokenHash: TOKEN_HASH,
          expiresAt: ONE_MS_AFTER,
          spent: true,
        },
      });
    },
    CASE_TIMEOUT_MS,
  );
}

import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { holdBefore } from '../../race-gate';
import { rerunAtOnce } from '../issuance-contract/issuance-contract-support';
import { AuthorityContractHarness } from './authority-contract-harness';
import {
  ABORT_AFTER_EVENT,
  AuthorityHarnessSource,
  failAfter,
  outcomeOf,
  signIn,
  SignedIn,
  storedFor,
  validates,
} from './authority-contract-support';

const ISSUED = 'session_issued';
const REVOKED = 'session_revoked';

interface Workflow {
  name: string;
  run: (
    harness: AuthorityContractHarness,
    userId: string,
    kept: SignedIn,
  ) => Promise<unknown>;
}

/** The three sign-out workflows, each run for an account with two sessions. */
const WORKFLOWS: Workflow[] = [
  {
    name: 'sign out',
    run: (harness, _userId, kept) =>
      harness.revoker(rerunAtOnce).revokeByToken(kept.token),
  },
  {
    name: 'sign out everywhere else',
    run: (harness, userId, kept) =>
      harness
        .revoker(rerunAtOnce)
        .revokeAllOthersExceptSession(userId, kept.sessionId),
  },
  {
    name: 'sign out everywhere',
    run: (harness, userId) =>
      harness.revoker(rerunAtOnce).revokeAllForUser(userId),
  },
];

const NOTHING_STORED = {
  outcome: ErrorCode.AUTHORITY_UNAVAILABLE,
  stored: {
    accountVersion: 0,
    sessions: [
      { live: true, userVersion: 0 },
      { live: true, userVersion: 0 },
    ],
    events: [ISSUED, ISSUED],
  },
  validates: [true, true],
};

export function revocationAtomicityCases(
  harness: AuthorityHarnessSource,
): void {
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restores) restore();
    restores = [];
  });

  async function twoSessions() {
    const userId = await harness().issuance.seedAccount();
    const kept = await signIn(harness(), userId, 'kept/1');
    const other = await signIn(harness(), userId, 'other/1');
    return { userId, kept, other };
  }

  async function observed(
    outcome: unknown,
    user: Awaited<ReturnType<typeof twoSessions>>,
  ) {
    return {
      outcome,
      stored: await storedFor(harness(), user.userId, [
        user.kept.sessionId,
        user.other.sessionId,
      ]),
      validates: [
        await validates(harness(), user.kept.token),
        await validates(harness(), user.other.token),
      ],
    };
  }

  it.each(WORKFLOWS)(
    'stores nothing of "$name" when the database refuses its event',
    async (workflow) => {
      const user = await twoSessions();
      const restore = await harness().issuance.refuseSecurityEvents();
      restores.push(restore);
      const outcome = await outcomeOf(
        workflow.run(harness(), user.userId, user.kept),
      );
      restore();
      expect(await observed(outcome, user)).toEqual(NOTHING_STORED);
    },
  );

  it.each(WORKFLOWS)(
    'stores nothing of "$name", the event included, when the work is aborted after the event',
    async (workflow) => {
      const user = await twoSessions();
      const restore = failAfter(
        harness().revocationStore,
        'appendSecurityEvent',
        new Error(ABORT_AFTER_EVENT),
      );
      restores.push(restore);
      const outcome = await outcomeOf(
        workflow.run(harness(), user.userId, user.kept),
      );
      restore();
      expect(await observed(outcome, user)).toEqual(NOTHING_STORED);
    },
  );

  /** Counts how often the work reached its one guarded write. */
  function countRevocations(): () => number {
    let calls = 0;
    restores.push(
      holdBefore(harness().revocationStore, 'revokeSession', () => {
        calls += 1;
        return undefined;
      }),
    );
    return () => calls;
  }

  it('reports a sign-out as done, and never runs it again, when the answer to a commit that landed is lost', async () => {
    const user = await twoSessions();
    const revocations = countRevocations();
    const lost = harness().issuance.loseCommitAnswers({
      lands: true,
      times: 1,
    });
    restores.push(lost.restore);
    const outcome = await outcomeOf(
      harness().revoker(rerunAtOnce).revokeByToken(user.other.token),
    );
    lost.restore();
    expect({
      outcome,
      workRuns: revocations(),
      otherValidates: await validates(harness(), user.other.token),
      events: (await storedFor(harness(), user.userId, [user.other.sessionId]))
        .events,
    }).toEqual({
      outcome: true,
      workRuns: 1,
      otherValidates: false,
      events: [ISSUED, ISSUED, REVOKED],
    });
  });

  it('still signs out exactly once when the answer is lost before the commit landed', async () => {
    const user = await twoSessions();
    const lost = harness().issuance.loseCommitAnswers({
      lands: false,
      times: 1,
    });
    restores.push(lost.restore);
    const outcome = await outcomeOf(
      harness().revoker(rerunAtOnce).revokeByToken(user.other.token),
    );
    lost.restore();
    expect({
      outcome,
      otherValidates: await validates(harness(), user.other.token),
      keptValidates: await validates(harness(), user.kept.token),
      events: (await storedFor(harness(), user.userId, [user.other.sessionId]))
        .events,
    }).toEqual({
      outcome: true,
      otherValidates: false,
      keptValidates: true,
      events: [ISSUED, ISSUED, REVOKED],
    });
  });

  it.each([
    { lands: true, validatesAfter: false, events: [ISSUED, ISSUED, REVOKED] },
    { lands: false, validatesAfter: true, events: [ISSUED, ISSUED] },
  ])(
    'reports an unknown outcome and runs the work once when no answer can be had (landed: $lands)',
    async ({ lands, validatesAfter, events }) => {
      const user = await twoSessions();
      const revocations = countRevocations();
      const lost = harness().issuance.loseCommitAnswers({ lands });
      restores.push(lost.restore);
      const outcome = await outcomeOf(
        harness().revoker(rerunAtOnce).revokeByToken(user.other.token),
      );
      lost.restore();
      expect({
        outcome,
        workRuns: revocations(),
        otherValidates: await validates(harness(), user.other.token),
        events: (
          await storedFor(harness(), user.userId, [user.other.sessionId])
        ).events,
      }).toEqual({
        outcome: ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
        workRuns: 1,
        otherValidates: validatesAfter,
        events,
      });
    },
  );
}

import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { UnknownTransactionOutcomeError } from '../../../../src/common/persistence/persistence-errors';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import {
  contractSession,
  HarnessSource,
  rejectionOf,
  rerunAtOnce,
  SIGN_IN_ADDRESS,
  storedCounts,
  WEB_CLIENT,
} from './issuance-contract-support';

const HASH_A = 'a'.repeat(64);
const SIGN_IN_EVENT = 'session_issued';

/** One unit of work stores everything or nothing, and never reports a guess. */
export function issuanceAtomicityCases(harness: HarnessSource): void {
  const inUnitOfWork = <Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> => harness().runner(rerunAtOnce).run(work);
  const signIn = (userId: string) =>
    harness()
      .service(rerunAtOnce)
      .createBrowserSession(userId, 'Contract/1', SIGN_IN_ADDRESS);

  it.each([
    ['a first sign-in', 0],
    ['a later sign-in', 1],
  ] as const)(
    'stores nothing for %s whose security event the database refuses',
    async (_, earlier) => {
      const userId = await harness().seedAccount();
      for (let index = 0; index < earlier; index += 1) {
        await signIn(userId);
      }
      const before = await storedCounts(harness(), userId);
      const allowEvents = await harness().refuseSecurityEvents();

      let failure: unknown;
      try {
        failure = await rejectionOf(signIn(userId));
      } finally {
        allowEvents();
      }

      expect({
        code: failure instanceof Error ? Reflect.get(failure, 'code') : failure,
        before,
        after: await storedCounts(harness(), userId),
      }).toEqual({
        code: ErrorCode.AUTHORITY_UNAVAILABLE,
        before: {
          sessions: earlier,
          grants: earlier,
          grantFences: earlier === 0 ? [] : [1],
          accountFence: earlier,
          events: earlier,
        },
        after: {
          sessions: earlier,
          grants: earlier,
          grantFences: earlier === 0 ? [] : [1],
          accountFence: earlier,
          events: earlier,
        },
      });
    },
  );

  it('rolls back everything written when the work throws, and rethrows its error', async () => {
    const userId = await harness().seedAccount();
    const stop = new Error('the caller changed its mind');

    const failure = await rejectionOf(
      inUnitOfWork(async (unitOfWork) => {
        await harness().store.markAccountIssuance(unitOfWork, userId);
        await harness().store.insertBrowserSession(
          unitOfWork,
          contractSession(userId, HASH_A),
        );
        throw stop;
      }),
    );

    expect({
      sameError: failure === stop,
      ...(await storedCounts(harness(), userId)),
    }).toEqual({
      sameError: true,
      sessions: 0,
      grants: 0,
      grantFences: [],
      accountFence: 0,
      events: 0,
    });
  });

  it('does not commit, and does not return, when the work swallowed a store failure', async () => {
    const userId = await harness().seedAccount();
    const allowEvents = await harness().refuseSecurityEvents();

    let failure: unknown;
    try {
      failure = await rejectionOf(
        inUnitOfWork(async (unitOfWork) => {
          await harness().store.markAccountIssuance(unitOfWork, userId);
          await harness()
            .store.appendSecurityEvent(unitOfWork, {
              targetUserId: userId,
              clientId: WEB_CLIENT,
              sessionId: 'contract-session',
              action: SIGN_IN_EVENT,
            })
            .catch(() => undefined);
        }),
      );
    } finally {
      allowEvents();
    }

    expect({
      failed: failure instanceof Error,
      fence: (await harness().account(userId))?.issuanceFence,
    }).toEqual({ failed: true, fence: 0 });
  });

  it.each([
    ['stored', true, 1],
    ['never stored', false, 0],
  ] as const)(
    'runs the work once and reports an unknown outcome when the commit answer is lost (%s)',
    async (_, lands, stored) => {
      const userId = await harness().seedAccount();
      const lost = harness().loseCommitAnswers({ lands });
      let workRuns = 0;

      let failure: unknown;
      try {
        failure = await rejectionOf(
          inUnitOfWork(async (unitOfWork) => {
            workRuns += 1;
            await harness().store.markAccountIssuance(unitOfWork, userId);
          }),
        );
      } finally {
        lost.restore();
      }

      expect({
        unknown: failure instanceof UnknownTransactionOutcomeError,
        workRuns,
        fence: (await harness().account(userId))?.issuanceFence,
      }).toEqual({ unknown: true, workRuns: 1, fence: stored });
    },
  );

  it('answers a sign-in whose commit answer is lost as an unknown outcome, signed in once', async () => {
    const userId = await harness().seedAccount();
    const lost = harness().loseCommitAnswers({ lands: true });

    let failure: unknown;
    try {
      failure = await rejectionOf(signIn(userId));
    } finally {
      lost.restore();
    }

    expect({
      code: failure instanceof Error ? Reflect.get(failure, 'code') : failure,
      ...(await storedCounts(harness(), userId)),
    }).toEqual({
      code: ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
      sessions: 1,
      grants: 1,
      grantFences: [1],
      accountFence: 1,
      events: 1,
    });
  });
}

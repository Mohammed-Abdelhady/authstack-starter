import { WEB_CLIENT_ID } from '../../../../src/session/constants/client-ids';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { RetryableAbortError } from '../../../../src/common/persistence/persistence-errors';
import { IssuedBrowserSession } from '../../../../src/session/services/session-issuance.service';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  WEB_APPLICATION,
  HarnessSource,
  holdReruns,
  rejectionOf,
  rerunAtOnce,
  SESSION_CAP,
  SIGN_IN_ADDRESS,
  signInTimes,
  storedCounts,
} from './issuance-contract-support';

const SIGNED_IN = 'signed in';
const REFUSED_AT_ACCOUNT = 'refused at the account';
const COUNTED_UNDER_FIRST = 'counted while the first held the account';

async function outcomeOf(
  signIn: Promise<IssuedBrowserSession>,
): Promise<string> {
  try {
    await signIn;
    return SIGNED_IN;
  } catch (error) {
    const code: unknown =
      error instanceof Error ? Reflect.get(error, 'code') : '';
    return typeof code === 'string' ? code : 'failed without a code';
  }
}

/**
 * Two sign-ins for one account. The first is held after it has counted the
 * account's sessions and before it stores its own, so it owns the account. The
 * second must be refused at the account and wait to run again: the case awaits
 * that refusal, so both sides are proven where they stand before either moves.
 */
export function issuanceRaceCases(harness: HarnessSource): void {
  let gates: RaceGate[] = [];
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const gate of gates) gate.release();
    for (const restore of restores) restore();
    gates = [];
    restores = [];
  });

  function gate(): RaceGate {
    const created = new RaceGate();
    gates.push(created);
    return created;
  }

  /** Call 0 is the first sign-in's own insert. Any later insert is the second's. */
  function holdInserts(first: RaceGate, later?: RaceGate): void {
    restores.push(
      holdBefore(harness().store, 'insertBrowserSession', (call) =>
        call === 0 ? first : later,
      ),
    );
  }

  async function raceTwoSignIns(userId: string) {
    const reruns = holdReruns();
    gates.push(reruns.refused);
    const service = harness().service(reruns.pause);
    const firstCounted = gate();
    const secondCounted = gate();
    holdInserts(firstCounted, secondCounted);

    const first = outcomeOf(
      service.createBrowserSession(
        userId,
        'first/1',
        SIGN_IN_ADDRESS,
        WEB_CLIENT_ID,
      ),
    );
    await firstCounted.reached(1);
    const second = outcomeOf(
      service.createBrowserSession(
        userId,
        'second/1',
        SIGN_IN_ADDRESS,
        WEB_CLIENT_ID,
      ),
    );
    const secondWas = await Promise.race([
      reruns.refused.reached(1).then(() => REFUSED_AT_ACCOUNT),
      secondCounted.reached(1).then(() => COUNTED_UNDER_FIRST),
    ]);
    const whileBothHeld = await storedCounts(harness(), userId);

    firstCounted.release();
    secondCounted.release();
    const firstOutcome = await first;
    reruns.refused.release();
    return {
      secondWas,
      whileBothHeld,
      first: firstOutcome,
      second: await second,
      pauses: reruns.calls,
    };
  }

  it('admits exactly one of two sign-ins at the last free slot', async () => {
    const userId = await harness().seedAccount();
    await signInTimes(harness().service(rerunAtOnce), userId, SESSION_CAP - 1);

    const race = await raceTwoSignIns(userId);

    expect({ race, after: await storedCounts(harness(), userId) }).toEqual({
      race: {
        secondWas: REFUSED_AT_ACCOUNT,
        whileBothHeld: {
          sessions: 19,
          grants: 1,
          grantFences: [19],
          accountFence: 19,
          events: 19,
        },
        first: SIGNED_IN,
        second: ErrorCode.SESSION_LIMIT_REACHED,
        pauses: [1],
      },
      after: {
        sessions: 20,
        grants: 1,
        grantFences: [20],
        accountFence: 20,
        events: 20,
      },
    });
  });

  it('admits only one concurrent sign-in at a configured per-application cap', async () => {
    await harness().seedApplication({ ...WEB_APPLICATION, sessionCap: 1 });
    const userId = await harness().seedAccount();

    const race = await raceTwoSignIns(userId);

    expect({
      first: race.first,
      second: race.second,
      pauses: race.pauses,
      sessions: (await harness().sessions(userId)).length,
    }).toEqual({
      first: SIGNED_IN,
      second: ErrorCode.SESSION_LIMIT_REACHED,
      pauses: [1],
      sessions: 1,
    });
  });

  it('admits the refused sign-in on its rerun when a slot is still free', async () => {
    const userId = await harness().seedAccount();

    const race = await raceTwoSignIns(userId);

    expect({ race, after: await storedCounts(harness(), userId) }).toEqual({
      race: {
        secondWas: REFUSED_AT_ACCOUNT,
        whileBothHeld: {
          sessions: 0,
          grants: 0,
          grantFences: [],
          accountFence: 0,
          events: 0,
        },
        first: SIGNED_IN,
        second: SIGNED_IN,
        pauses: [1],
      },
      after: {
        sessions: 2,
        grants: 1,
        grantFences: [2],
        accountFence: 2,
        events: 2,
      },
    });
  });

  it('gives up as a retryable abort after three refusals while the first still holds the account', async () => {
    const userId = await harness().seedAccount();
    const firstCounted = gate();
    holdInserts(firstCounted);
    const first = outcomeOf(
      harness()
        .service(rerunAtOnce)
        .createBrowserSession(
          userId,
          'first/1',
          SIGN_IN_ADDRESS,
          WEB_CLIENT_ID,
        ),
    );
    await firstCounted.reached(1);

    const pauses: number[] = [];
    let workRuns = 0;
    const failure = await rejectionOf(
      harness()
        .runner((failedAttempts) => {
          pauses.push(failedAttempts);
          return Promise.resolve();
        })
        .run(async (unitOfWork) => {
          workRuns += 1;
          await harness().store.readAccountForIssuance(unitOfWork, userId);
          await harness().store.markAccountIssuance(unitOfWork, userId);
        }),
    );
    const second = await outcomeOf(
      harness()
        .service(rerunAtOnce)
        .createBrowserSession(
          userId,
          'second/1',
          SIGN_IN_ADDRESS,
          WEB_CLIENT_ID,
        ),
    );
    const whileHeld = await storedCounts(harness(), userId);
    firstCounted.release();

    expect({
      retryable: failure instanceof RetryableAbortError,
      workRuns,
      pauses,
      second,
      whileHeld,
      first: await first,
      after: await storedCounts(harness(), userId),
    }).toEqual({
      retryable: true,
      workRuns: 3,
      pauses: [1, 2],
      second: ErrorCode.AUTHORITY_UNAVAILABLE,
      whileHeld: {
        sessions: 0,
        grants: 0,
        grantFences: [],
        accountFence: 0,
        events: 0,
      },
      first: SIGNED_IN,
      after: {
        sessions: 1,
        grants: 1,
        grantFences: [1],
        accountFence: 1,
        events: 1,
      },
    });
  });

  it('lets another account sign in while the first holds its own', async () => {
    const heldUser = await harness().seedAccount();
    const otherUser = await harness().seedAccount();
    const firstCounted = gate();
    holdInserts(firstCounted);
    const first = outcomeOf(
      harness()
        .service(rerunAtOnce)
        .createBrowserSession(
          heldUser,
          'first/1',
          SIGN_IN_ADDRESS,
          WEB_CLIENT_ID,
        ),
    );
    await firstCounted.reached(1);

    const other = await outcomeOf(
      harness()
        .service(rerunAtOnce)
        .createBrowserSession(
          otherUser,
          'other/1',
          SIGN_IN_ADDRESS,
          WEB_CLIENT_ID,
        ),
    );
    const heldWhileOtherSignedIn = (await harness().sessions(heldUser)).length;
    firstCounted.release();

    expect({ other, heldWhileOtherSignedIn, first: await first }).toEqual({
      other: SIGNED_IN,
      heldWhileOtherSignedIn: 0,
      first: SIGNED_IN,
    });
  });
}

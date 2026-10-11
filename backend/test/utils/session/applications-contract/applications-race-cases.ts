import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import type { NativeApplicationConfiguration } from '../../../../src/config/types/native-application.type';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  outcomeOf,
  signIn,
  validates,
} from '../authority-contract/authority-contract-support';
import {
  holdReruns,
  rejectionOf,
  rerunAtOnce,
  SIGN_IN_ADDRESS,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import {
  accessOn,
  ApplicationsHarnessSource,
  MOBILE,
  nativeApplication,
  reconcile,
  storedNatives,
} from './applications-contract-support';

const REFUSED = 'refused at once';
const WROTE_UNDER_THE_FIRST = 'wrote while the first was open';

/**
 * Each case holds the first unit of work open at a store method, proves it
 * stands there, starts the second, and waits for the second to be refused (its
 * rerun pause is a gate the case holds) or to get as far as a write of its own.
 * Nothing is released before both are where the case says they are.
 */
export function applicationRaceCases(harness: ApplicationsHarnessSource): void {
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

  function refusedOr(refused: RaceGate, wrote: RaceGate): Promise<string> {
    return Promise.race([
      refused.reached(1).then(() => REFUSED),
      wrote.reached(1).then(() => WROTE_UNDER_THE_FIRST),
    ]);
  }

  /**
   * Call 0 of the last store write is the first reconciliation's: by then it
   * has stored every listed application, uncommitted. A later call is the
   * second's, which has then stored its own under the first.
   */
  function holdReconciliations(first: RaceGate, later: RaceGate): void {
    restores.push(
      holdBefore(
        harness().registryStore,
        'disableNativeApplicationsExcept',
        (call) => (call === 0 ? first : later),
      ),
    );
  }

  async function raceTwoReconciliations(
    configured: NativeApplicationConfiguration[],
  ) {
    const reruns = holdReruns();
    gates.push(reruns.refused);
    const firstWrote = gate();
    const secondWrote = gate();
    holdReconciliations(firstWrote, secondWrote);

    const first = reconcile(harness(), configured);
    await firstWrote.reached(1);
    const second = reconcile(harness(), configured, reruns.pause);
    const secondWas = await refusedOr(reruns.refused, secondWrote);
    const whileBothOpen = await storedNatives(harness());

    firstWrote.release();
    secondWrote.release();
    await first;
    reruns.refused.release();
    await second;
    return {
      secondWas,
      whileBothOpen,
      pauses: reruns.calls,
      after: await storedNatives(harness()),
    };
  }

  it('two starts that create the same application leave one, at version 0: the second is refused while the first is open', async () => {
    expect(await raceTwoReconciliations([MOBILE])).toEqual({
      secondWas: REFUSED,
      whileBothOpen: [],
      pauses: [1],
      after: [
        {
          clientId: 'configured-mobile',
          environment: 'test',
          enabled: true,
          sessionVersion: 0,
        },
      ],
    });
  });

  it('two starts that both find a redirect address removed advance the version once', async () => {
    await harness().seedStoredApplication(
      nativeApplication({
        redirectUris: ['example-native://callback', 'example-native://old'],
        sessionVersion: 3,
      }),
    );
    await harness().seedStoredApplication(
      nativeApplication({ clientId: 'manual-mobile', sessionVersion: 2 }),
    );

    expect(await raceTwoReconciliations([MOBILE])).toEqual({
      secondWas: REFUSED,
      whileBothOpen: [
        {
          clientId: 'configured-mobile',
          environment: 'test',
          enabled: true,
          sessionVersion: 3,
        },
        {
          clientId: 'manual-mobile',
          environment: 'test',
          enabled: true,
          sessionVersion: 2,
        },
      ],
      pauses: [1],
      after: [
        {
          clientId: 'configured-mobile',
          environment: 'test',
          enabled: true,
          sessionVersion: 4,
        },
        {
          clientId: 'manual-mobile',
          environment: 'test',
          enabled: false,
          sessionVersion: 3,
        },
      ],
    });
  });

  it('a start that stays refused gives up after three attempts, and the first start stands', async () => {
    const firstWrote = gate();
    holdReconciliations(firstWrote, gate());
    const first = reconcile(harness(), [MOBILE]);
    await firstWrote.reached(1);
    const pauses: number[] = [];
    const recording: RerunPause = (failedAttempts) => {
      pauses.push(failedAttempts);
      return Promise.resolve();
    };

    const second = await rejectionOf(reconcile(harness(), [MOBILE], recording));
    firstWrote.release();
    await first;

    expect({
      secondFailed: second instanceof Error,
      pauses,
      after: await storedNatives(harness()),
    }).toEqual({
      secondFailed: true,
      pauses: [1, 2],
      after: [
        {
          clientId: 'configured-mobile',
          environment: 'test',
          enabled: true,
          sessionVersion: 0,
        },
      ],
    });
  });

  it('a block is refused while a sign-in of the same person is open, and ends the new session once it reruns', async () => {
    const userId = await harness().authority.issuance.seedAccount();
    await signIn(harness().authority, userId, 'earlier/1');
    const reruns = holdReruns();
    gates.push(reruns.refused);
    const signInCounted = gate();
    const blockWrote = gate();
    restores.push(
      holdBefore(
        harness().authority.issuance.store,
        'insertBrowserSession',
        () => signInCounted,
      ),
      holdBefore(
        harness().accessStore,
        'appendSecurityEvent',
        () => blockWrote,
      ),
    );

    const signingIn = harness()
      .authority.issuance.service(rerunAtOnce)
      .createBrowserSession(userId, 'racing/1', SIGN_IN_ADDRESS);
    await signInCounted.reached(1);
    const blocking = outcomeOf(
      accessOn(harness(), reruns.pause).blockGrant(userId, WEB_CLIENT),
    );
    const blockWas = await refusedOr(reruns.refused, blockWrote);
    signInCounted.release();
    blockWrote.release();
    const issued = await signingIn;
    reruns.refused.release();
    const blocked = await blocking;

    const grant = await harness().grant(userId, WEB_CLIENT);
    expect({
      blockWas,
      blocked,
      pauses: reruns.calls,
      grant: {
        allowed: grant?.allowed,
        sessionVersion: grant?.sessionVersion,
      },
      newSessionValidates: await validates(
        harness().authority,
        issued.sessionToken,
      ),
      sessions: (await harness().authority.issuance.sessions(userId)).length,
    }).toEqual({
      blockWas: REFUSED,
      blocked: undefined,
      pauses: [1],
      grant: { allowed: false, sessionVersion: 1 },
      newSessionValidates: false,
      sessions: 2,
    });
  });

  it('a sign-in is refused while a block of the same person is open, and is kept out once it reruns', async () => {
    const userId = await harness().authority.issuance.seedAccount();
    await signIn(harness().authority, userId, 'earlier/1');
    const reruns = holdReruns();
    gates.push(reruns.refused);
    const blockWrote = gate();
    const signInCounted = gate();
    restores.push(
      holdBefore(
        harness().accessStore,
        'appendSecurityEvent',
        () => blockWrote,
      ),
      holdBefore(
        harness().authority.issuance.store,
        'insertBrowserSession',
        () => signInCounted,
      ),
    );

    const blocking = accessOn(harness()).blockGrant(userId, WEB_CLIENT);
    await blockWrote.reached(1);
    const signingIn = outcomeOf(
      harness()
        .authority.issuance.service(reruns.pause)
        .createBrowserSession(userId, 'racing/1', SIGN_IN_ADDRESS),
    );
    const signInWas = await refusedOr(reruns.refused, signInCounted);
    blockWrote.release();
    signInCounted.release();
    await blocking;
    reruns.refused.release();

    expect({
      signInWas,
      signedIn: await signingIn,
      pauses: reruns.calls,
      sessions: (await harness().authority.issuance.sessions(userId)).length,
    }).toEqual({
      signInWas: REFUSED,
      signedIn: ErrorCode.GRANT_BLOCKED,
      pauses: [1],
      sessions: 1,
    });
  });
}

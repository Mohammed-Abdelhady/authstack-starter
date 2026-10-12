import { holdBefore } from '../../race-gate';
import {
  rerunAtOnce,
  SESSION_CAP,
  signInTimes,
} from '../../session/issuance-contract/issuance-contract-support';
import {
  actions,
  answerOf,
  approvedCode,
  exchange,
  NATIVE_CLIENT,
  NativeHarnessSource,
} from './native-contract-support';
import { nativeRaceTools, REFUSED } from './native-race-support';

/** Two exchanges that want the same code, or the same last session slot. */
export function exchangeRaceCases(harness: NativeHarnessSource): void {
  const { gate, restoreLater, heldReruns, refusedOr } = nativeRaceTools();

  it('exchanges a code once when two exchanges present it together', async () => {
    const userId = await harness().issuance.seedAccount();
    const code = await approvedCode(harness().services(), userId);
    const firstSpend = gate();
    const secondSpend = gate();
    const reruns = heldReruns();
    const services = harness().services({ pause: reruns.pause });
    restoreLater(
      holdBefore(harness().stores.authorizations, 'spendCodeIn', (call) =>
        call === 0 ? firstSpend : secondSpend,
      ),
    );

    const first = exchange(services, code);
    await firstSpend.reached(1);
    const second = exchange(services, code);
    const secondWas = await refusedOr(reruns.refused, secondSpend);
    firstSpend.release();
    const winner = await first;
    reruns.refused.release();
    secondSpend.release();
    const loser = await second;

    const [session] = await harness().issuance.sessions(userId);
    expect({
      secondWas,
      answers: [answerOf(winner), answerOf(loser)],
      pauses: reruns.calls,
      sessions: (await harness().issuance.sessions(userId)).length,
      tokens: (await harness().credentialsOf(session.id)).length,
      accountFence: (await harness().issuance.account(userId))?.issuanceFence,
    }).toEqual({
      secondWas: REFUSED,
      answers: ['ok', 'invalid_grant'],
      pauses: [1],
      sessions: 1,
      tokens: 2,
      accountFence: 1,
    });
  });

  it('admits one of two exchanges at the last session slot and leaves the other code usable', async () => {
    const userId = await harness().issuance.seedAccount();
    const firstCode = await approvedCode(harness().services(), userId);
    const secondCode = await approvedCode(harness().services(), userId);
    await signInTimes(
      harness().issuance.service(rerunAtOnce),
      userId,
      SESSION_CAP - 1,
    );
    const firstInsert = gate();
    const secondInsert = gate();
    const reruns = heldReruns();
    const services = harness().services({ pause: reruns.pause });
    restoreLater(
      holdBefore(harness().stores.credentials, 'insertNativeSession', (call) =>
        call === 0 ? firstInsert : secondInsert,
      ),
    );

    const first = exchange(services, firstCode);
    await firstInsert.reached(1);
    const second = exchange(services, secondCode);
    const secondWas = await refusedOr(reruns.refused, secondInsert);
    firstInsert.release();
    const winner = await first;
    reruns.refused.release();
    secondInsert.release();
    const loser = await second;

    const sessions = await harness().issuance.sessions(userId);
    expect({
      secondWas,
      answers: [answerOf(winner), answerOf(loser)],
      pauses: reruns.calls,
      sessions: sessions.length,
      nativeSessions: sessions.filter(
        ({ clientId }) => clientId === NATIVE_CLIENT,
      ).length,
      codes: [
        (await harness().authorization(firstCode.transactionId))?.consumed,
        (await harness().authorization(secondCode.transactionId))?.consumed,
      ],
      accountFence: (await harness().issuance.account(userId))?.issuanceFence,
    }).toEqual({
      secondWas: REFUSED,
      answers: ['ok', 'access_denied'],
      pauses: [1],
      sessions: SESSION_CAP,
      nativeSessions: 1,
      codes: [true, false],
      accountFence: SESSION_CAP,
    });
  });

  it('issues and counts nothing for an exchange that read its code before another exchange spent it', async () => {
    const userId = await harness().issuance.seedAccount();
    const code = await approvedCode(harness().services(), userId);
    const firstAccountRead = gate();
    const reruns = heldReruns();
    const services = harness().services({ pause: reruns.pause });
    restoreLater(
      holdBefore(harness().issuance.store, 'readAccountForIssuance', (call) =>
        call === 0 ? firstAccountRead : undefined,
      ),
    );

    const first = exchange(services, code).then(answerOf);
    await firstAccountRead.reached(1);
    const second = exchange(services, code).then(answerOf);
    // The second either finishes under the first, or is refused at the code
    // the first has taken. Both are where they will stay before any release.
    const secondWas = await Promise.race([
      second.then(() => 'finished'),
      reruns.refused.reached(1).then(() => REFUSED),
    ]);
    firstAccountRead.release();
    // Whoever was refused runs again only once the other has ended.
    if (secondWas === REFUSED) {
      await first;
    }
    reruns.refused.release();
    const firstAnswer = await first;

    expect({
      answers: [firstAnswer, await second].sort(),
      sessions: (await harness().issuance.sessions(userId)).length,
      accountFence: (await harness().issuance.account(userId))?.issuanceFence,
      issued: (await actions(harness())).length,
    }).toEqual({
      answers: ['invalid_grant', 'ok'],
      sessions: 1,
      accountFence: 1,
      issued: 1,
    });
  });
}

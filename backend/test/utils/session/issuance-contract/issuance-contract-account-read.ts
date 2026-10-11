import { MalformedIdError } from '../../../../src/common/persistence/persistence-errors';
import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { RaceGate } from '../../race-gate';
import {
  HarnessSource,
  rejectionOf,
  rerunAtOnce,
  SIGN_IN_ADDRESS,
} from './issuance-contract-support';

/** The account read that takes nothing, for work that renews what sign-in issued. */
export function issuanceAccountReadCases(harness: HarnessSource): void {
  const find = (userId: string) =>
    harness()
      .runner(rerunAtOnce)
      .run((unitOfWork) => harness().store.findAccount(unitOfWork, userId));

  it('reads an account with its deletion mark and version, deleted or not', async () => {
    const live = await harness().seedAccount();
    const deleted = await harness().seedAccount({ deleted: true });
    await harness().bumpAccountVersion(live);

    expect({
      live: await find(live),
      deleted: await find(deleted),
    }).toEqual({
      live: { id: live, isDeleted: false, sessionVersion: 1 },
      deleted: { id: deleted, isDeleted: true, sessionVersion: 0 },
    });
  });

  it("reads nothing for an id that names no account, and refuses another database's id", async () => {
    expect({
      absent: await find(harness().absentAccountId()),
      foreignIsMalformed:
        (await rejectionOf(find(harness().foreignAccountId()))) instanceof
        MalformedIdError,
    }).toEqual({ absent: null, foreignIsMalformed: true });
  });

  it('does not take the account: a sign-in completes while the unit of work that read it is still open', async () => {
    const userId = await harness().seedAccount();
    const readDone = new RaceGate();
    const pauses: number[] = [];
    const recording: RerunPause = (failedAttempts) => {
      pauses.push(failedAttempts);
      return Promise.resolve();
    };

    const reading = harness()
      .runner(rerunAtOnce)
      .run(async (unitOfWork) => {
        const account = await harness().store.findAccount(unitOfWork, userId);
        await readDone.hold();
        return account;
      });
    await readDone.reached(1);
    let signedIn: unknown;
    try {
      await harness()
        .service(recording)
        .createBrowserSession(userId, 'Contract/1', SIGN_IN_ADDRESS);
      signedIn = 'signed in';
    } catch (error) {
      signedIn = error;
    } finally {
      readDone.release();
    }

    expect({
      signedIn,
      pauses,
      read: await reading,
      sessions: (await harness().sessions(userId)).length,
    }).toEqual({
      signedIn: 'signed in',
      pauses: [],
      read: { id: userId, isDeleted: false, sessionVersion: 0 },
      sessions: 1,
    });
  });
}

import { MalformedIdError } from '../../../../src/common/persistence/persistence-errors';
import { TEST_NOW } from '../../frozen-clock';
import { failAfter } from '../../session/authority-contract/authority-contract-support';
import {
  rejectionOf,
  rerunAtOnce,
} from '../../session/issuance-contract/issuance-contract-support';
import { NativeContractHarness } from './native-contract-harness';
import {
  ABORTED,
  begin,
  NATIVE_REDIRECT,
  NativeHarnessSource,
} from './native-contract-support';
import { nativeRaceTools } from './native-race-support';

const PENDING_UNTIL = new Date('2099-01-01T12:05:00.000Z');
const CODE_UNTIL = new Date('2099-01-01T12:01:00.000Z');

/** The guarded writes of the request store, and approve and deny at once. */
export function authorizationStoreCases(harness: NativeHarnessSource): void {
  const { restoreLater } = nativeRaceTools();

  async function pendingId(h: NativeContractHarness): Promise<{
    id: string;
    transactionId: string;
  }> {
    const { transactionId } = await begin(h.services());
    const stored = await h.authorization(transactionId);
    if (!stored) {
      throw new Error('begin stored nothing');
    }
    return { id: stored.id, transactionId };
  }

  function approveIn(
    h: NativeContractHarness,
    id: string,
    userId: string,
    codeHash: string,
    now = TEST_NOW,
  ) {
    return h.issuance.runner(rerunAtOnce).run((unitOfWork) =>
      h.stores.authorizations.approve(unitOfWork, id, {
        now,
        codeHash,
        codeExpiresAt: CODE_UNTIL,
        userId,
        capturedUserVersion: 0,
        capturedClientVersion: 0,
        authenticationMethods: [],
      }),
    );
  }

  it('says whether an approval found the request pending', async () => {
    const userId = await harness().issuance.seedAccount();
    const once = await pendingId(harness());
    const denied = await pendingId(harness());
    const expired = await pendingId(harness());
    await harness().services().browser.deny(denied.transactionId);

    expect({
      first: await approveIn(harness(), once.id, userId, 'hash-1'),
      second: await approveIn(harness(), once.id, userId, 'hash-2'),
      denied: await approveIn(harness(), denied.id, userId, 'hash-3'),
      atExpiry: await approveIn(
        harness(),
        expired.id,
        userId,
        'hash-4',
        PENDING_UNTIL,
      ),
      absent: await approveIn(
        harness(),
        harness().absentId(),
        userId,
        'hash-5',
      ),
      storedHash: (await harness().authorization(once.transactionId))?.codeHash,
      malformed: await rejectionOf(
        approveIn(harness(), harness().foreignId(), userId, 'hash-6'),
      ),
    }).toEqual({
      first: 'approved',
      second: 'not_pending',
      denied: 'not_pending',
      atExpiry: 'not_pending',
      absent: 'not_pending',
      storedHash: 'hash-1',
      malformed: expect.any(MalformedIdError),
    });
  });

  it('captures the grant version only on the request that holds the code', async () => {
    const userId = await harness().issuance.seedAccount();
    const { id, transactionId } = await pendingId(harness());
    await approveIn(harness(), id, userId, 'hash-1');
    const capture = (codeHash: string, version: number) =>
      harness()
        .issuance.runner(rerunAtOnce)
        .run((unitOfWork) =>
          harness().stores.authorizations.captureGrantVersion(
            unitOfWork,
            id,
            codeHash,
            version,
          ),
        );

    expect({
      otherCode: await capture('hash-of-another-approval', 9),
      ownCode: await capture('hash-1', 4),
      stored: (await harness().authorization(transactionId))
        ?.capturedGrantVersion,
    }).toEqual({ otherCode: 'not_approved', ownCode: 'captured', stored: 4 });
  });

  it('says whether a denial found the request pending, and only for its own return address', async () => {
    const store = harness().stores.authorizations;
    const userId = await harness().issuance.seedAccount();
    const open = await pendingId(harness());
    const approved = await pendingId(harness());
    const late = await pendingId(harness());
    await approveIn(harness(), approved.id, userId, 'hash-1');
    const guard = (transactionId: string, now = TEST_NOW) => ({
      transactionId,
      redirectUri: NATIVE_REDIRECT,
      now,
    });

    expect({
      otherAddress: await store.deny(open.id, {
        ...guard(open.transactionId),
        redirectUri: 'otherapp://callback',
      }),
      otherRequest: await store.deny(open.id, guard(late.transactionId)),
      first: await store.deny(open.id, guard(open.transactionId)),
      second: await store.deny(open.id, guard(open.transactionId)),
      approved: await store.deny(approved.id, guard(approved.transactionId)),
      atExpiry: await store.deny(
        late.id,
        guard(late.transactionId, PENDING_UNTIL),
      ),
      malformed: await rejectionOf(
        store.deny(harness().foreignId(), guard(open.transactionId)),
      ),
    }).toEqual({
      otherAddress: { outcome: 'not_pending' },
      otherRequest: { outcome: 'not_pending' },
      first: {
        outcome: 'denied',
        redirectUri: NATIVE_REDIRECT,
        state: 'state-1',
      },
      second: { outcome: 'not_pending' },
      approved: { outcome: 'not_pending' },
      atExpiry: { outcome: 'not_pending' },
      malformed: expect.any(MalformedIdError),
    });
  });

  it.each([
    {
      step: 'the grant is created',
      abort: (h: NativeContractHarness) =>
        failAfter(h.issuance.store, 'createGrant', new Error(ABORTED)),
    },
    {
      step: 'the grant version is captured',
      abort: (h: NativeContractHarness) =>
        failAfter(
          h.stores.authorizations,
          'captureGrantVersion',
          new Error(ABORTED),
        ),
    },
  ])('stores nothing of an approval aborted after $step', async ({ abort }) => {
    const userId = await harness().issuance.seedAccount();
    const { transactionId } = await begin(harness().services());
    restoreLater(abort(harness()));

    const failure = await rejectionOf(
      harness().services().authorize.approve(userId, transactionId, ['pw']),
    );
    expect({
      failure: failure instanceof Error ? failure.message : failure,
      stored: await harness().authorization(transactionId),
      grants: await harness().issuance.grants(userId),
    }).toMatchObject({
      failure: ABORTED,
      stored: {
        consumed: false,
        codeHash: null,
        userId: null,
        expiresAt: PENDING_UNTIL,
        capturedUserVersion: null,
        authenticationMethods: [],
      },
      grants: [],
    });
  });
}

import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import { TEST_NOW } from '../../frozen-clock';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import { NativeContractHarness } from './native-contract-harness';
import {
  familyState,
  granted,
  NATIVE_CLIENT,
  NativeHarnessSource,
  proofFor,
  refresh,
  sha256Hex,
  signInNative,
  storedToken,
} from './native-contract-support';

const LATER = new Date('2099-01-01T12:00:30.000Z');
const UNTIL = new Date('2099-01-01T12:05:00.000Z');
const ONE_MS_BEFORE_UNTIL = new Date('2099-01-01T12:04:59.999Z');

/** Each guarded write of the same-key retry, with both its answers. */
export function retryStoreCases(harness: NativeHarnessSource): void {
  function inWork<Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> {
    return harness().issuance.runner(rerunAtOnce).run(work);
  }

  async function family(h: NativeContractHarness, boundBy?: string) {
    const signedIn = await signInNative(h, { boundBy });
    const [access, refreshToken] = await h.credentialsOf(signedIn.sessionId);
    return { signedIn, access, refreshToken };
  }

  it('takes a retry only on a spent, unended token whose claim is free or has lapsed', async () => {
    const store = harness().stores.rotations;
    const { refreshToken } = await family(harness());
    const ended = await family(harness());
    const claim = (id: string, now: Date, until = UNTIL) =>
      inWork((unitOfWork) => store.claimRetry(unitOfWork, id, { now, until }));

    const unspent = await claim(refreshToken.id, TEST_NOW);
    await inWork((unitOfWork) =>
      store.claimRefresh(unitOfWork, refreshToken.id, TEST_NOW),
    );
    await inWork(async (unitOfWork) => {
      await store.claimRefresh(unitOfWork, ended.refreshToken.id, TEST_NOW);
      await harness().stores.credentials.revokeFamily(unitOfWork, {
        familyId: ended.refreshToken.familyId,
        sessionId: ended.signedIn.sessionId,
        now: TEST_NOW,
        reason: 'contract',
      });
    });
    expect({
      unspent,
      free: await claim(refreshToken.id, TEST_NOW),
      held: await claim(refreshToken.id, ONE_MS_BEFORE_UNTIL),
      lapsed: await claim(
        refreshToken.id,
        UNTIL,
        new Date('2099-01-01T12:10:00.000Z'),
      ),
      ended: await claim(ended.refreshToken.id, TEST_NOW),
    }).toEqual({
      unspent: 'in_progress',
      free: 'claimed',
      held: 'in_progress',
      lapsed: 'claimed',
      ended: 'in_progress',
    });
  });

  it('names a replacement only while the claim of the retry still holds', async () => {
    const store = harness().stores.rotations;
    const { signedIn, refreshToken } = await family(harness());
    const link = (now: Date) =>
      inWork((unitOfWork) =>
        store.linkReplacement(unitOfWork, refreshToken.id, {
          accessHash: 'replacement-access',
          refreshHash: 'replacement-refresh',
          now,
        }),
      );

    const unclaimed = await link(TEST_NOW);
    await inWork(async (unitOfWork) => {
      await store.claimRefresh(unitOfWork, refreshToken.id, TEST_NOW);
      await store.claimRetry(unitOfWork, refreshToken.id, {
        now: TEST_NOW,
        until: UNTIL,
      });
    });
    expect({
      unclaimed,
      atTheEndOfTheClaim: await link(UNTIL),
      hashAfterRefusals: (
        await storedToken(
          harness(),
          signedIn.sessionId,
          signedIn.tokens.refreshToken,
        )
      ).successorRefreshHash,
      inside: await link(ONE_MS_BEFORE_UNTIL),
      stored: (
        await storedToken(
          harness(),
          signedIn.sessionId,
          signedIn.tokens.refreshToken,
        )
      ).successorRefreshHash,
    }).toEqual({
      unclaimed: 'claim_lapsed',
      atTheEndOfTheClaim: 'claim_lapsed',
      hashAfterRefusals: null,
      inside: 'linked',
      stored: 'replacement-refresh',
    });
  });

  it('finds a successor pair only while neither half was spent, ended or used, and ends both halves together', async () => {
    const store = harness().stores.rotations;
    const h = harness();
    const rotated = async (name: string) => {
      const signedIn = await signInNative(h, { boundBy: `${name}-x` });
      const next = granted(
        await refresh(
          h.services(),
          signedIn.tokens.refreshToken,
          proofFor(`${name}-r`, signedIn.tokens.refreshToken),
        ),
      );
      const spent = await storedToken(
        h,
        signedIn.sessionId,
        signedIn.tokens.refreshToken,
      );
      const lookup = () =>
        inWork((unitOfWork) =>
          store.findUnusedSuccessor(unitOfWork, {
            accessHash: sha256Hex(next.accessToken),
            refreshHash: sha256Hex(next.refreshToken),
            familyId: spent.familyId,
            sessionId: signedIn.sessionId,
            clientId: NATIVE_CLIENT,
            generation: 1,
          }),
        );
      return { signedIn, next, lookup };
    };
    const unused = await rotated('unused');
    const used = await rotated('used');
    const rotatedOn = await rotated('rotated-on');
    await h.services().access.validate(used.next.accessToken);
    const third = granted(
      await refresh(
        h.services(),
        rotatedOn.next.refreshToken,
        proofFor('rotated-on-r2', rotatedOn.next.refreshToken),
      ),
    );
    // A refresh half that was spent, with an access half nobody has used.
    const spentRefreshUnusedAccess = {
      accessId: (
        await storedToken(h, rotatedOn.signedIn.sessionId, third.accessToken)
      ).id,
      refreshId: (
        await storedToken(
          h,
          rotatedOn.signedIn.sessionId,
          rotatedOn.next.refreshToken,
        )
      ).id,
    };

    const found = await unused.lookup();
    const expected = {
      accessId: (
        await storedToken(h, unused.signedIn.sessionId, unused.next.accessToken)
      ).id,
      refreshId: (
        await storedToken(
          h,
          unused.signedIn.sessionId,
          unused.next.refreshToken,
        )
      ).id,
      generation: 2,
    };
    const end = (successor: { accessId: string; refreshId: string }) =>
      inWork((unitOfWork) =>
        store.revokeUnusedSuccessor(unitOfWork, { ...successor, now: LATER }),
      );
    const usedIds = {
      accessId: (
        await storedToken(h, used.signedIn.sessionId, used.next.accessToken)
      ).id,
      refreshId: (
        await storedToken(h, used.signedIn.sessionId, used.next.refreshToken)
      ).id,
    };
    expect({
      found,
      accessUsed: await used.lookup(),
      refreshSpent: await rotatedOn.lookup(),
      endUsed: await end(usedIds),
      endSpentRefresh: await end(spentRefreshUnusedAccess),
      endUnused: await end(expected),
      endAgain: await end(expected),
      afterEnding: await unused.lookup(),
      unusedFamily: await familyState(h, unused.signedIn.sessionId),
    }).toEqual({
      found: expected,
      accessUsed: null,
      refreshSpent: null,
      endUsed: 'already_used',
      endSpentRefresh: 'already_used',
      endUnused: 'revoked',
      endAgain: 'already_used',
      afterEnding: null,
      unusedFamily: {
        sessionLive: true,
        revokedReason: null,
        tokens: 4,
        unspent: 0,
        unrevoked: 1,
      },
    });
  });
}

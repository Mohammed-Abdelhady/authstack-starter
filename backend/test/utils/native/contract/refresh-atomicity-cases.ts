import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { holdBefore } from '../../race-gate';
import { failAfter } from '../../session/authority-contract/authority-contract-support';
import { NativeContractHarness } from './native-contract-harness';
import {
  ABORTED,
  actions,
  answerOf,
  familyState,
  granted,
  NativeHarnessSource,
  outcomeOf,
  refresh,
  signInNative,
} from './native-contract-support';

const FIRST_PAIR = {
  sessionLive: true,
  revokedReason: null,
  tokens: 2,
  unspent: 2,
  unrevoked: 2,
};
/** After one rotation: the old access token is ended, the old refresh token spent. */
const ROTATED_ONCE = { ...FIRST_PAIR, tokens: 4, unrevoked: 3 };

/** A rotation or a replay that fails part way, and a commit whose answer is lost. */
export function refreshAtomicityCases(harness: NativeHarnessSource): void {
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restores) restore();
    restores = [];
  });

  /** Counts how often the work reached its claim. */
  function countClaims(): () => number {
    let calls = 0;
    restores.push(
      holdBefore(harness().stores.rotations, 'claimRefresh', () => {
        calls += 1;
        return undefined;
      }),
    );
    return () => calls;
  }

  it('stores nothing of a rotation aborted after its new pair was stored', async () => {
    const signedIn = await signInNative(harness());
    restores.push(
      failAfter(
        harness().stores.credentials,
        'insertCredentialPair',
        new Error(ABORTED),
      ),
    );
    const outcome = await outcomeOf(
      refresh(harness().services(), signedIn.tokens.refreshToken),
    );
    expect({
      outcome,
      family: await familyState(harness(), signedIn.sessionId),
    }).toEqual({
      outcome: ErrorCode.AUTHORITY_UNAVAILABLE,
      family: FIRST_PAIR,
    });
  });

  it.each([
    {
      failure: 'the database refuses its event',
      fail: async (h: NativeContractHarness) =>
        h.issuance.refuseSecurityEvents(),
    },
    {
      failure: 'the work is aborted after the event',
      fail: (h: NativeContractHarness) =>
        Promise.resolve(
          failAfter(h.stores.events, 'record', new Error(ABORTED)),
        ),
    },
  ])(
    'leaves the family alive, and stores no event, when a replay fails because $failure',
    async ({ fail }) => {
      const signedIn = await signInNative(harness());
      const services = harness().services();
      granted(await refresh(services, signedIn.tokens.refreshToken));
      const restore = await fail(harness());
      restores.push(restore);

      const outcome = await outcomeOf(
        refresh(services, signedIn.tokens.refreshToken),
      );
      restore();
      expect({
        outcome,
        family: await familyState(harness(), signedIn.sessionId),
        events: await actions(harness()),
      }).toEqual({
        outcome: ErrorCode.AUTHORITY_UNAVAILABLE,
        family: ROTATED_ONCE,
        events: ['session_issued'],
      });
    },
  );

  it('rotates once, and never again, when the answer to a commit that landed is lost', async () => {
    const signedIn = await signInNative(harness());
    const claims = countClaims();
    const lost = harness().issuance.loseCommitAnswers({
      lands: true,
      times: 1,
    });
    restores.push(lost.restore);
    const answer = await outcomeOf(
      refresh(harness().services(), signedIn.tokens.refreshToken).then(
        answerOf,
      ),
    );
    lost.restore();
    expect({
      answer,
      claims: claims(),
      family: await familyState(harness(), signedIn.sessionId),
    }).toEqual({ answer: 'ok', claims: 1, family: ROTATED_ONCE });
  });

  it.each([
    { lands: true, family: ROTATED_ONCE },
    { lands: false, family: FIRST_PAIR },
  ])(
    'reports an unknown outcome and runs the rotation once when no answer can be had (landed: $lands)',
    async ({ lands, family }) => {
      const signedIn = await signInNative(harness());
      const claims = countClaims();
      const lost = harness().issuance.loseCommitAnswers({ lands });
      restores.push(lost.restore);
      const outcome = await outcomeOf(
        refresh(harness().services(), signedIn.tokens.refreshToken),
      );
      lost.restore();
      expect({
        outcome,
        claims: claims(),
        family: await familyState(harness(), signedIn.sessionId),
      }).toEqual({
        outcome: ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
        claims: 1,
        family,
      });
    },
  );
}

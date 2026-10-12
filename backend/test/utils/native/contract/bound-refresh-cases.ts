import { NativeContractHarness } from './native-contract-harness';
import {
  actions,
  answerOf,
  familyState,
  granted,
  NATIVE_CLIENT,
  NativeHarnessSource,
  proofFor,
  refresh,
  sha256Hex,
  SignedInNative,
  signInNative,
  storedToken,
} from './native-contract-support';

const INVALID_GRANT = 'invalid_grant';
const REFUSED_PROOF = 'native_dpop_proof_refused';
const FIVE_PAST = new Date('2099-01-01T12:05:00.000Z');
/** The retry window is five minutes. */
const FIVE_MINUTES_AGO = new Date('2099-01-01T11:55:00.000Z');
const ONE_MS_INSIDE_THE_WINDOW = new Date('2099-01-01T11:55:00.001Z');

const FIRST_PAIR = {
  sessionLive: true,
  revokedReason: null,
  tokens: 2,
  unspent: 2,
  unrevoked: 2,
};
const ENDED = {
  sessionLive: false,
  revokedReason: 'refresh_replayed',
  tokens: 4,
  unspent: 0,
  unrevoked: 0,
};

/** Rotation and the same-key retry for a family bound to a device key. */
export function boundRefreshCases(harness: NativeHarnessSource): void {
  async function rotatedOnce(h: NativeContractHarness, family = 'bound') {
    const signedIn = await signInNative(h, { boundBy: `${family}-exchange` });
    const successor = granted(
      await refresh(
        h.services(),
        signedIn.tokens.refreshToken,
        proofFor(`${family}-rotation`, signedIn.tokens.refreshToken),
      ),
    );
    return { signedIn, successor };
  }

  function retry(
    h: NativeContractHarness,
    signedIn: SignedInNative,
    jti: string,
  ) {
    return refresh(
      h.services(),
      signedIn.tokens.refreshToken,
      proofFor(jti, signedIn.tokens.refreshToken),
    );
  }

  it('rotates a bound family with its key, names the successor on the spent token and stores the proof id', async () => {
    const { signedIn, successor } = await rotatedOnce(harness());
    const spent = await storedToken(
      harness(),
      signedIn.sessionId,
      signedIn.tokens.refreshToken,
    );
    const next = await storedToken(
      harness(),
      signedIn.sessionId,
      successor.refreshToken,
    );
    expect({
      spent: {
        spent: spent.spent,
        successorAccessHash: spent.successorAccessHash,
        successorRefreshHash: spent.successorRefreshHash,
      },
      successorIsBound:
        next.proofKeyThumbprint !== null &&
        next.proofKeyThumbprint === spent.proofKeyThumbprint,
      proofIds: await harness().storedProofIds(),
      family: await familyState(harness(), signedIn.sessionId),
    }).toEqual({
      spent: {
        spent: true,
        successorAccessHash: sha256Hex(successor.accessToken),
        successorRefreshHash: sha256Hex(successor.refreshToken),
      },
      successorIsBound: true,
      proofIds: 2,
      family: { ...FIRST_PAIR, tokens: 4, unrevoked: 3 },
    });
  });

  it.each([
    {
      proof: 'no proof',
      sign: () => undefined,
      answer: 'invalid_dpop_proof NATIVE_DPOP_PROOF_REQUIRED',
      reason: 'NATIVE_DPOP_PROOF_REQUIRED',
    },
    {
      proof: 'a proof signed by another key',
      sign: (token: string) => proofFor('other-key', token, 'B'),
      answer: 'invalid_dpop_proof NATIVE_DPOP_KEY_MISMATCH',
      reason: 'NATIVE_DPOP_KEY_MISMATCH',
    },
    {
      proof: 'a proof made for another token',
      sign: () => proofFor('other-token', 'another-token'),
      answer: 'invalid_dpop_proof NATIVE_DPOP_PROOF_ATH_INVALID',
      reason: 'NATIVE_DPOP_PROOF_ATH_INVALID',
    },
    {
      proof: 'a proof id used before',
      sign: (token: string) => proofFor('bound-exchange', token),
      answer: 'invalid_dpop_proof NATIVE_DPOP_PROOF_REPLAYED',
      reason: 'NATIVE_DPOP_PROOF_REPLAYED',
    },
  ])(
    'refuses a bound family presented with $proof, records the refusal and spends nothing',
    async ({ sign, answer, reason }) => {
      const signedIn = await signInNative(harness(), {
        boundBy: 'bound-exchange',
      });
      const result = await refresh(
        harness().services(),
        signedIn.tokens.refreshToken,
        sign(signedIn.tokens.refreshToken),
      );
      expect({
        answer: answerOf(result),
        family: await familyState(harness(), signedIn.sessionId),
        proofIds: await harness().storedProofIds(),
        refusals: (await harness().events()).filter(
          ({ action }) => action === REFUSED_PROOF,
        ),
      }).toEqual({
        answer,
        family: FIRST_PAIR,
        proofIds: 1,
        refusals: [
          {
            action: REFUSED_PROOF,
            targetUserId: signedIn.userId,
            clientId: NATIVE_CLIENT,
            sessionId: signedIn.sessionId,
            reasonCode: reason,
            outcome: 'failed',
          },
        ],
      });
    },
  );

  it('answers a same-key retry of a spent token with a replacement pair and ends the pair that was lost', async () => {
    const { signedIn, successor } = await rotatedOnce(harness());
    const replacement = granted(
      await retry(harness(), signedIn, 'bound-retry'),
    );

    const names: Record<string, string> = {
      [sha256Hex(successor.accessToken)]: 'lost access',
      [sha256Hex(successor.refreshToken)]: 'lost refresh',
      [sha256Hex(replacement.accessToken)]: 'replacement access',
      [sha256Hex(replacement.refreshToken)]: 'replacement refresh',
    };
    const spent = await storedToken(
      harness(),
      signedIn.sessionId,
      signedIn.tokens.refreshToken,
    );
    expect({
      secondGeneration: (await harness().credentialsOf(signedIn.sessionId))
        .filter(({ generation }) => generation === 2)
        .map((token) => ({
          token: names[token.tokenHash],
          spent: token.spent,
          ended: token.revokedAt !== null,
        }))
        .sort((left, right) => left.token.localeCompare(right.token)),
      spent: {
        retryClaimUntil: spent.retryClaimUntil,
        successorAccessHash: spent.successorAccessHash,
        successorRefreshHash: spent.successorRefreshHash,
      },
      family: await familyState(harness(), signedIn.sessionId),
      events: await actions(harness()),
      proofIds: await harness().storedProofIds(),
    }).toEqual({
      secondGeneration: [
        { token: 'lost access', spent: true, ended: true },
        { token: 'lost refresh', spent: true, ended: true },
        { token: 'replacement access', spent: false, ended: false },
        { token: 'replacement refresh', spent: false, ended: false },
      ],
      spent: {
        retryClaimUntil: FIVE_PAST,
        successorAccessHash: sha256Hex(replacement.accessToken),
        successorRefreshHash: sha256Hex(replacement.refreshToken),
      },
      family: {
        sessionLive: true,
        revokedReason: null,
        tokens: 6,
        unspent: 2,
        unrevoked: 3,
      },
      events: ['session_issued', 'native_dpop_bound_retry'],
      proofIds: 3,
    });
  });

  it('retries one millisecond inside the window and ends the family at the window', async () => {
    const inside = await rotatedOnce(harness());
    const outside = await rotatedOnce(harness(), 'late');
    await harness().patchCredential(
      sha256Hex(inside.signedIn.tokens.refreshToken),
      { consumedAt: ONE_MS_INSIDE_THE_WINDOW },
    );
    await harness().patchCredential(
      sha256Hex(outside.signedIn.tokens.refreshToken),
      { consumedAt: FIVE_MINUTES_AGO },
    );

    expect({
      inside: answerOf(await retry(harness(), inside.signedIn, 'retry-in')),
      outside: answerOf(await retry(harness(), outside.signedIn, 'retry-out')),
      insideFamily: (await familyState(harness(), inside.signedIn.sessionId))
        .sessionLive,
      outsideFamily: await familyState(harness(), outside.signedIn.sessionId),
    }).toEqual({
      inside: 'ok',
      outside: INVALID_GRANT,
      insideFamily: true,
      outsideFamily: ENDED,
    });
  });

  it('ends the family when a spent token is retried after its successor was used', async () => {
    const { signedIn, successor } = await rotatedOnce(harness());
    const used = await harness()
      .services()
      .access.validate(successor.accessToken);

    const answer = await retry(harness(), signedIn, 'retry-after-use');
    expect({
      successorWasValid: used !== null,
      answer: answerOf(answer),
      family: await familyState(harness(), signedIn.sessionId),
      events: await actions(harness()),
    }).toEqual({
      successorWasValid: true,
      answer: INVALID_GRANT,
      family: ENDED,
      events: ['session_issued', 'refresh_replayed'],
    });
  });

  it('answers a second retry as in progress while the first one holds the claim, and keeps the family', async () => {
    const { signedIn } = await rotatedOnce(harness());
    const first = await retry(harness(), signedIn, 'retry-one');
    const second = await retry(harness(), signedIn, 'retry-two');
    expect({
      answers: [answerOf(first), answerOf(second)],
      family: await familyState(harness(), signedIn.sessionId),
      retries: (await actions(harness())).filter(
        (action) => action === 'native_dpop_bound_retry',
      ).length,
    }).toEqual({
      answers: ['ok', 'invalid_dpop_proof NATIVE_DPOP_RETRY_IN_PROGRESS'],
      family: {
        sessionLive: true,
        revokedReason: null,
        tokens: 6,
        unspent: 2,
        unrevoked: 3,
      },
      retries: 1,
    });
  });
}

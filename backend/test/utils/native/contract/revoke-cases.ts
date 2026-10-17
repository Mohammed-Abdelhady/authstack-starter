import { WEB_CLIENT_ID } from '../../../../src/session/constants/client-ids';
import { AppException } from '../../../../src/common/exceptions/app.exception';
import { signNativeDpopProof } from '../../../../src/session/native/harness/native-dpop-test-vectors.harness-spec';
import { failAfter } from '../../session/authority-contract/authority-contract-support';
import {
  rerunAtOnce,
  SIGN_IN_ADDRESS,
} from '../../session/issuance-contract/issuance-contract-support';
import { NativeContractHarness } from './native-contract-harness';
import {
  ABORTED,
  actions,
  familyState,
  NATIVE_CLIENT,
  NativeHarnessSource,
  outcomeOf,
  signInNative,
} from './native-contract-support';

const REVOKE_ADDRESS = 'https://api.example.test/api/oauth/revoke';
const CLIENT_REVOKED = 'native_client_revoked';
const REFUSED_PROOF = 'native_dpop_proof_refused';
const ALIVE = {
  sessionLive: true,
  revokedReason: null,
  tokens: 2,
  unspent: 2,
  unrevoked: 2,
};
const ENDED_BY_CLIENT = {
  sessionLive: false,
  revokedReason: CLIENT_REVOKED,
  tokens: 2,
  unspent: 0,
  unrevoked: 0,
};

function revokeProof(jti: string, token: string): string {
  return signNativeDpopProof({ token, claims: { jti, htu: REVOKE_ADDRESS } });
}

/** A client ending its own family, and a person signing a mobile session out. */
export function revokeCases(harness: NativeHarnessSource): void {
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restores) restore();
    restores = [];
  });

  function revoke(
    h: NativeContractHarness,
    body: Record<string, string>,
    proof?: string,
  ) {
    return h.services().tokens.revoke(body, proof);
  }

  it.each([
    { presented: 'its refresh token', pick: 'refreshToken' as const },
    { presented: 'its access token', pick: 'accessToken' as const },
  ])('ends a family when the client revokes $presented', async ({ pick }) => {
    const signedIn = await signInNative(harness());
    const answer = await revoke(harness(), {
      token: signedIn.tokens[pick],
      client_id: NATIVE_CLIENT,
    });
    expect({
      answer,
      family: await familyState(harness(), signedIn.sessionId),
      events: (await harness().events()).slice(1),
      accessAfter: await harness()
        .services()
        .access.validate(signedIn.tokens.accessToken),
    }).toEqual({
      answer: { ok: true },
      family: ENDED_BY_CLIENT,
      events: [
        {
          action: CLIENT_REVOKED,
          targetUserId: signedIn.userId,
          clientId: NATIVE_CLIENT,
          sessionId: signedIn.sessionId,
          reasonCode: null,
          outcome: 'succeeded',
        },
      ],
      accessAfter: null,
    });
  });

  it('answers a revoke of an unknown token, or by another client, as done and changes nothing', async () => {
    const signedIn = await signInNative(harness());
    const token = signedIn.tokens.refreshToken;
    const answers = [
      await revoke(harness(), { token: 'no-such-token' }),
      await revoke(harness(), { token, client_id: 'web' }),
      await revoke(harness(), { token: '   ' }),
      await revoke(harness(), { token, client_secret: 'secret' }),
      await harness()
        .services({ nativeEnabled: false })
        .tokens.revoke({ token }),
    ];
    expect({
      answers: answers.map((answer) => (answer.ok ? 'ok' : answer.error)),
      family: await familyState(harness(), signedIn.sessionId),
      events: await actions(harness()),
    }).toEqual({
      answers: [
        'ok',
        'ok',
        'invalid_request',
        'invalid_client',
        'unauthorized_client',
      ],
      family: ALIVE,
      events: ['session_issued'],
    });
  });

  it('needs the device key to end a bound family, and refuses a proof id used before', async () => {
    const first = await signInNative(harness(), { boundBy: 'revoke-x1' });
    const second = await signInNative(harness(), { boundBy: 'revoke-x2' });
    const tokenOf = (signedIn: typeof first) => signedIn.tokens.refreshToken;

    const withoutKey = await revoke(harness(), { token: tokenOf(first) });
    const afterRefusal = await familyState(harness(), first.sessionId);
    const withKey = await revoke(
      harness(),
      { token: tokenOf(first) },
      revokeProof('revoke-1', tokenOf(first)),
    );
    const replayed = await revoke(
      harness(),
      { token: tokenOf(second) },
      revokeProof('revoke-1', tokenOf(second)),
    );

    const describe = (answer: typeof withoutKey) =>
      answer.ok ? 'ok' : `${answer.error} ${answer.error_description}`;
    expect({
      withoutKey: describe(withoutKey),
      afterRefusal,
      withKey: describe(withKey),
      firstFamily: await familyState(harness(), first.sessionId),
      replayed: describe(replayed),
      secondFamily: await familyState(harness(), second.sessionId),
      proofIds: await harness().storedProofIds(),
      refusals: (await harness().events())
        .filter(({ action }) => action === REFUSED_PROOF)
        .map(({ sessionId, reasonCode, outcome }) => ({
          sessionId,
          reasonCode,
          outcome,
        })),
    }).toEqual({
      withoutKey: 'invalid_dpop_proof NATIVE_DPOP_PROOF_REQUIRED',
      afterRefusal: ALIVE,
      withKey: 'ok',
      firstFamily: ENDED_BY_CLIENT,
      replayed: 'invalid_dpop_proof NATIVE_DPOP_PROOF_REPLAYED',
      secondFamily: ALIVE,
      proofIds: 3,
      refusals: [
        {
          sessionId: first.sessionId,
          reasonCode: 'NATIVE_DPOP_PROOF_REQUIRED',
          outcome: 'failed',
        },
        {
          sessionId: second.sessionId,
          reasonCode: 'NATIVE_DPOP_PROOF_REPLAYED',
          outcome: 'failed',
        },
      ],
    });
  });

  it.each([
    {
      failure: 'the database refuses its event',
      fail: (h: NativeContractHarness) => h.issuance.refuseSecurityEvents(),
      raised: 'a database failure',
    },
    {
      failure: 'the work is aborted after the event',
      fail: (h: NativeContractHarness) =>
        Promise.resolve(
          failAfter(h.stores.events, 'record', new Error(ABORTED)),
        ),
      raised: ABORTED,
    },
  ])(
    'leaves the family alive, and stores no event, when a client revoke fails because $failure',
    async ({ fail, raised }) => {
      const signedIn = await signInNative(harness());
      const restore = await fail(harness());
      restores.push(restore);
      const outcome = await outcomeOf(
        revoke(harness(), { token: signedIn.tokens.refreshToken }),
      );
      restore();
      expect({
        raised:
          outcome instanceof Error && !(outcome instanceof AppException)
            ? outcome.message === ABORTED
              ? ABORTED
              : 'a database failure'
            : outcome,
        family: await familyState(harness(), signedIn.sessionId),
        events: await actions(harness()),
      }).toEqual({ raised, family: ALIVE, events: ['session_issued'] });
    },
  );

  it('signs a mobile session out: the session and every token end, with one event', async () => {
    const signedIn = await signInNative(harness());
    const signedOut = await harness()
      .services()
      .signOut.revokeNativeSession(signedIn.sessionId, signedIn.userId);
    expect({
      signedOut,
      family: await familyState(harness(), signedIn.sessionId),
      events: (await harness().events()).slice(1),
    }).toEqual({
      signedOut: true,
      family: { ...ENDED_BY_CLIENT, revokedReason: 'current_logout' },
      events: [
        {
          action: 'session_revoked',
          targetUserId: signedIn.userId,
          clientId: NATIVE_CLIENT,
          sessionId: signedIn.sessionId,
          reasonCode: 'current_logout',
          outcome: 'succeeded',
        },
      ],
    });
  });

  it('signs out nothing that is not a live mobile session of the account', async () => {
    const signedIn = await signInNative(harness());
    const stranger = await harness().issuance.seedAccount();
    const signOut = harness().services().signOut;
    await harness()
      .issuance.service(rerunAtOnce)
      .createBrowserSession(
        signedIn.userId,
        'Browser/1',
        SIGN_IN_ADDRESS,
        WEB_CLIENT_ID,
      );
    const browser = (await harness().issuance.sessions(signedIn.userId)).find(
      ({ clientId }) => clientId !== NATIVE_CLIENT,
    );
    const ended = await signInNative(harness());
    await harness().revokeSession(ended.sessionId);

    expect({
      anotherAccount: await signOut.revokeNativeSession(
        signedIn.sessionId,
        stranger,
      ),
      browserSession: await signOut.revokeNativeSession(
        browser?.id ?? '',
        signedIn.userId,
      ),
      alreadyEnded: await signOut.revokeNativeSession(
        ended.sessionId,
        ended.userId,
      ),
      absent: await signOut.revokeNativeSession(
        harness().absentId(),
        signedIn.userId,
      ),
      malformed: await signOut.revokeNativeSession(
        harness().foreignId(),
        signedIn.userId,
      ),
      family: await familyState(harness(), signedIn.sessionId),
      browserStillValid: (
        await harness().issuance.sessions(signedIn.userId)
      ).every(({ isValid }) => isValid),
      revocations: (await actions(harness())).filter(
        (action) => action === 'session_revoked',
      ).length,
    }).toEqual({
      anotherAccount: false,
      browserSession: false,
      alreadyEnded: false,
      absent: false,
      malformed: false,
      family: ALIVE,
      browserStillValid: true,
      revocations: 0,
    });
  });

  it('stores nothing of a mobile sign-out, the event included, when the work is aborted after the event', async () => {
    const signedIn = await signInNative(harness());
    restores.push(
      failAfter(harness().stores.events, 'record', new Error(ABORTED)),
    );
    const outcome = await outcomeOf(
      harness()
        .services()
        .signOut.revokeNativeSession(signedIn.sessionId, signedIn.userId),
    );
    expect({
      outcome,
      family: await familyState(harness(), signedIn.sessionId),
      events: await actions(harness()),
    }).toEqual({
      outcome: 'AUTHORITY_UNAVAILABLE',
      family: ALIVE,
      events: ['session_issued'],
    });
  });
}

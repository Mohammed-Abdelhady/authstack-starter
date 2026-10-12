import { NativeContractHarness } from './native-contract-harness';
import {
  actions,
  answerOf,
  familyState,
  granted,
  NATIVE_CLIENT,
  NATIVE_META,
  NativeHarnessSource,
  refresh,
  sha256Hex,
  signInNative,
} from './native-contract-support';

const INVALID_GRANT = 'invalid_grant';
const ABSOLUTE = new Date('2099-01-31T12:00:00.000Z');
const ONE_PAST = new Date('2099-01-01T12:01:00.000Z');
const SIX_PAST = new Date('2099-01-01T12:06:00.000Z');
const THREE_PAST = new Date('2099-01-01T12:03:00.000Z');
const ONE_MS_BEFORE_THREE_PAST = new Date('2099-01-01T12:02:59.999Z');

const FIRST_PAIR = {
  sessionLive: true,
  revokedReason: null,
  tokens: 2,
  unspent: 2,
  unrevoked: 2,
};
/** After one rotation: the old access token is ended, the old refresh token spent. */
const ENDED = {
  sessionLive: false,
  revokedReason: 'refresh_replayed',
  tokens: 4,
  unspent: 0,
  unrevoked: 0,
};

/** Rotation, replay and their atomicity for a family without a device key. */
export function refreshCases(harness: NativeHarnessSource): void {
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const restore of restores) restore();
    restores = [];
  });

  it('spends a refresh token once and stores its successor pair with it', async () => {
    const signedIn = await signInNative(harness());
    harness().issuance.clock.set(ONE_PAST);
    const rotated = granted(
      await refresh(harness().services(), signedIn.tokens.refreshToken),
    );

    const names: Record<string, string> = {
      [sha256Hex(signedIn.tokens.accessToken)]: 'old access',
      [sha256Hex(signedIn.tokens.refreshToken)]: 'old refresh',
      [sha256Hex(rotated.accessToken)]: 'new access',
      [sha256Hex(rotated.refreshToken)]: 'new refresh',
    };
    const tokens = await harness().credentialsOf(signedIn.sessionId);
    expect({
      expiresIn: rotated.expiresIn,
      tokens: tokens.map((token) => ({
        token: names[token.tokenHash],
        generation: token.generation,
        sameFamily: token.familyId === tokens[0].familyId,
        expiresAt: token.expiresAt,
        spent: token.spent,
        consumedAt: token.consumedAt,
        revokedAt: token.revokedAt,
        successor: token.successorRefreshHash,
      })),
      sessions: (await harness().issuance.sessions(signedIn.userId)).length,
      events: await actions(harness()),
    }).toEqual({
      expiresIn: 300,
      tokens: [
        {
          token: 'old access',
          generation: 1,
          sameFamily: true,
          expiresAt: new Date('2099-01-01T12:05:00.000Z'),
          spent: true,
          consumedAt: null,
          revokedAt: ONE_PAST,
          successor: null,
        },
        {
          token: 'old refresh',
          generation: 1,
          sameFamily: true,
          expiresAt: ABSOLUTE,
          spent: true,
          consumedAt: ONE_PAST,
          revokedAt: null,
          successor: null,
        },
        {
          token: 'new access',
          generation: 2,
          sameFamily: true,
          expiresAt: SIX_PAST,
          spent: false,
          consumedAt: null,
          revokedAt: null,
          successor: null,
        },
        {
          token: 'new refresh',
          generation: 2,
          sameFamily: true,
          expiresAt: ABSOLUTE,
          spent: false,
          consumedAt: null,
          revokedAt: null,
          successor: null,
        },
      ],
      sessions: 1,
      events: ['session_issued'],
    });
  });

  it('refuses what is not a live refresh token of this client and leaves the family as it was', async () => {
    const signedIn = await signInNative(harness());
    const tokens = harness().services().tokens;
    const ask = (refreshToken: string, clientId = NATIVE_CLIENT) =>
      tokens.grant(
        {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
        },
        NATIVE_META,
      );

    expect({
      unknown: answerOf(await ask('no-such-token')),
      accessToken: answerOf(await ask(signedIn.tokens.accessToken)),
      otherClient: answerOf(await ask(signedIn.tokens.refreshToken, 'web')),
      blank: answerOf(await ask('   ')),
      family: await familyState(harness(), signedIn.sessionId),
      events: await actions(harness()),
    }).toEqual({
      unknown: INVALID_GRANT,
      accessToken: INVALID_GRANT,
      otherClient: INVALID_GRANT,
      blank: 'invalid_request',
      family: FIRST_PAIR,
      events: ['session_issued'],
    });
  });

  it('rotates one millisecond before the refresh token expires and not at its expiry, with the row still stored', async () => {
    const late = await signInNative(harness());
    const inTime = await signInNative(harness());
    for (const { tokens } of [late, inTime]) {
      await harness().patchCredential(sha256Hex(tokens.refreshToken), {
        expiresAt: THREE_PAST,
      });
    }
    const services = harness().services();

    harness().issuance.clock.set(THREE_PAST);
    const atExpiry = await refresh(services, late.tokens.refreshToken);
    harness().issuance.clock.set(ONE_MS_BEFORE_THREE_PAST);
    const before = await refresh(services, inTime.tokens.refreshToken);

    expect({
      atExpiry: answerOf(atExpiry),
      before: answerOf(before),
      lateFamily: await familyState(harness(), late.sessionId),
    }).toEqual({
      atExpiry: INVALID_GRANT,
      before: 'ok',
      lateFamily: FIRST_PAIR,
    });
  });

  it('ends the family when a spent refresh token is presented again, and answers a failure', async () => {
    const signedIn = await signInNative(harness());
    const services = harness().services();
    const successor = granted(
      await refresh(services, signedIn.tokens.refreshToken),
    );

    const replay = await refresh(services, signedIn.tokens.refreshToken);
    const afterReplay = {
      family: await familyState(harness(), signedIn.sessionId),
      events: await harness().events(),
    };
    const successorAnswer = await refresh(services, successor.refreshToken);

    expect({
      replay: answerOf(replay),
      afterReplay,
      successor: answerOf(successorAnswer),
      eventsAfterSuccessor: await actions(harness()),
      accessAfter: await services.access.validate(successor.accessToken),
    }).toEqual({
      replay: INVALID_GRANT,
      afterReplay: {
        family: ENDED,
        events: [
          expect.objectContaining({ action: 'session_issued' }),
          {
            action: 'refresh_replayed',
            targetUserId: signedIn.userId,
            clientId: NATIVE_CLIENT,
            sessionId: signedIn.sessionId,
            reasonCode: null,
            outcome: 'succeeded',
          },
        ],
      },
      successor: INVALID_GRANT,
      eventsAfterSuccessor: ['session_issued', 'refresh_replayed'],
      accessAfter: null,
    });
  });

  it.each([
    {
      loss: 'the account signed out everywhere',
      lose: (h: NativeContractHarness, userId: string) =>
        h.issuance.bumpAccountVersion(userId),
    },
    {
      loss: 'the account was deleted',
      lose: (h: NativeContractHarness, userId: string) =>
        h.markAccountDeleted(userId),
    },
    {
      loss: 'the grant was blocked',
      lose: (h: NativeContractHarness, userId: string) =>
        h.patchGrant(userId, { allowed: false }),
    },
    {
      loss: 'the grant is gone',
      lose: (h: NativeContractHarness, userId: string) => h.removeGrant(userId),
    },
    {
      loss: 'the application was disabled',
      lose: (h: NativeContractHarness) =>
        h.seedNativeApplication({ enabled: false }),
    },
    {
      loss: 'the application is no longer a mobile one',
      lose: (h: NativeContractHarness) =>
        h.seedNativeApplication({ platform: 'web' }),
    },
    {
      loss: 'the session was signed out',
      lose: (h: NativeContractHarness, _userId: string, sessionId: string) =>
        h.revokeSession(sessionId),
    },
  ])(
    'refuses a rotation when $loss, without spending the token',
    async ({ lose }) => {
      const signedIn = await signInNative(harness());
      await lose(harness(), signedIn.userId, signedIn.sessionId);
      const answer = await refresh(
        harness().services(),
        signedIn.tokens.refreshToken,
      );
      const family = await familyState(harness(), signedIn.sessionId);
      expect({
        answer: answerOf(answer),
        tokens: family.tokens,
        unspent: family.unspent,
        replays: (await actions(harness())).filter(
          (action) => action === 'refresh_replayed',
        ).length,
      }).toEqual({ answer: INVALID_GRANT, tokens: 2, unspent: 2, replays: 0 });
    },
  );

  it('refuses a family without a device key when a key is required', async () => {
    const signedIn = await signInNative(harness());
    const answer = await refresh(
      harness().services({ dpopRequired: true }),
      signedIn.tokens.refreshToken,
    );
    expect({
      answer: answerOf(answer),
      family: await familyState(harness(), signedIn.sessionId),
    }).toEqual({
      answer: 'invalid_dpop_proof NATIVE_DPOP_REQUIRED',
      family: FIRST_PAIR,
    });
  });
}

import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import { hashToken } from '../../utils/hashing/token-hash';
import { signNativeDpopProof } from '../harness/native-dpop-test-vectors.harness-spec';
import {
  OAUTH_ERROR,
  TokenSuccess,
  OauthFailure,
} from '../oauth/native-oauth.types';
import {
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NativeOauthHarness,
  issueBoundNativeGrant,
  issueNativeGrant,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../persistence/mongo/harness/native-oauth.harness-spec';
import { NativeRefreshRotationService } from './native-refresh-rotation.service';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { RaceGate, holdBefore } from '../../../../test/utils/race-gate';

type RefreshAnswer = TokenSuccess | OauthFailure;

describe('two refreshes of one token at once', () => {
  let ctx: NativeOauthHarness;
  let restoreClaim: (() => void) | undefined;
  let gates: RaceGate[] = [];

  beforeAll(async () => {
    ctx = await startNativeOauth('native_refresh_double_rotation');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  afterEach(() => {
    for (const gate of gates) {
      gate.release();
    }
    restoreClaim?.();
    restoreClaim = undefined;
    gates = [];
  });

  /**
   * Run both refreshes up to their claim, where each has read the token unspent
   * and neither has spent it. Let one finish, hand its answer to `between`,
   * then let the other go.
   */
  async function raceToTheClaim<Between>(
    first: () => Promise<RefreshAnswer>,
    second: () => Promise<RefreshAnswer>,
    between: (winner: RefreshAnswer) => Promise<Between>,
  ): Promise<{ winner: RefreshAnswer; loser: RefreshAnswer; held: Between }> {
    const firstClaim = new RaceGate();
    const secondClaim = new RaceGate();
    gates = [firstClaim, secondClaim];
    restoreClaim = holdBefore(
      ctx.harness.app.get(NativeRefreshRotationService),
      'claimAndRotate',
      (call) => [firstClaim, secondClaim][call],
    );

    const racers = [first(), second()];
    await firstClaim.reached(1);
    await secondClaim.reached(1);

    firstClaim.release();
    const winner = await Promise.race(racers);
    const held = await between(winner);
    secondClaim.release();
    const answers = await Promise.all(racers);
    const loser = answers.find((answer) => answer !== winner);
    if (!loser) {
      throw new Error('the second refresh did not answer');
    }
    return { winner, loser, held };
  }

  async function credentialState(refreshToken: string) {
    const row = await ctx.credentials
      .findOne({ tokenHash: hashToken(refreshToken) })
      .lean()
      .exec();
    return {
      stored: row !== null,
      spent: row?.spent,
      revoked: row?.revokedAt instanceof Date,
    };
  }

  async function nativeSession() {
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    if (!session) {
      throw new Error('expected a native session');
    }
    return session;
  }

  function successorOf(answer: RefreshAnswer): string {
    if (!answer.ok) {
      throw new Error(`expected a rotation, got ${answer.error}`);
    }
    return answer.refreshToken;
  }

  it('stores one successor and ends the family on the second, without a device key', async () => {
    const granted = await issueNativeGrant(ctx);
    const refresh = () => rotate(ctx, granted.refreshToken);

    const { winner, loser, held } = await raceToTheClaim(
      refresh,
      refresh,
      (answer) => credentialState(successorOf(answer)),
    );

    const session = await nativeSession();
    const credentials = await ctx.credentials
      .find({ sessionId: session._id })
      .lean()
      .exec();
    expect({
      winnerOk: winner.ok,
      successorWhileLoserHeld: held,
      loser,
      sessionValid: session.isValid,
      revokedReason: session.revokedReason,
      credentialCount: credentials.length,
      unspentCount: credentials.filter((row) => !row.spent).length,
      unrevokedCount: credentials.filter(
        (row) => !(row.revokedAt instanceof Date),
      ).length,
      successorAfterwards: await rotate(ctx, successorOf(winner)),
    }).toEqual({
      winnerOk: true,
      successorWhileLoserHeld: { stored: true, spent: false, revoked: false },
      loser: expect.objectContaining({
        ok: false,
        error: OAUTH_ERROR.INVALID_GRANT,
      }),
      sessionValid: false,
      revokedReason: SECURITY_EVENT_ACTION.REFRESH_REPLAYED,
      credentialCount: 4,
      unspentCount: 0,
      unrevokedCount: 0,
      successorAfterwards: expect.objectContaining({
        ok: false,
        error: OAUTH_ERROR.INVALID_GRANT,
      }),
    });
  });

  it('replaces the first pair with the second when the same device key signs both', async () => {
    const granted = await issueBoundNativeGrant(ctx);
    const refreshWith = (jti: string) => () =>
      rotate(
        ctx,
        granted.refreshToken,
        signNativeDpopProof({
          token: granted.refreshToken,
          claims: { jti },
        }),
      );

    const { winner, loser } = await raceToTheClaim(
      refreshWith('double-rotation-a'),
      refreshWith('double-rotation-b'),
      () => Promise.resolve(undefined),
    );

    const session = await nativeSession();
    expect({
      firstPair: await credentialState(successorOf(winner)),
      replacementPair: await credentialState(successorOf(loser)),
      liveCredentials: await ctx.credentials.countDocuments({
        sessionId: session._id,
        spent: false,
        revokedAt: { $exists: false },
      }),
      sessionValid: session.isValid,
      retryEvents: await ctx.securityEvents.countDocuments({
        action: SECURITY_EVENT_ACTION.NATIVE_DPOP_BOUND_RETRY,
      }),
      replayEvents: await ctx.securityEvents.countDocuments({
        action: SECURITY_EVENT_ACTION.REFRESH_REPLAYED,
      }),
    }).toEqual({
      firstPair: { stored: true, spent: true, revoked: true },
      replacementPair: { stored: true, spent: false, revoked: false },
      liveCredentials: 2,
      sessionValid: true,
      retryEvents: 1,
      replayEvents: 0,
    });
  });
});

function rotate(
  ctx: NativeOauthHarness,
  refreshToken: string,
  dpopProof?: string,
): Promise<RefreshAnswer> {
  return ctx.tokens.grant(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: NATIVE_CLIENT_ID,
    },
    NATIVE_META,
    dpopProof,
  );
}

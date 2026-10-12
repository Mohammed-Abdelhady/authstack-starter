import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  OAUTH_ERROR,
  TokenSuccess,
  OauthFailure,
} from '../oauth/native-oauth.types';
import {
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NativeOauthHarness,
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

interface HeldRace {
  spentToken: string;
  successorToken: string;
  replaying: Promise<RefreshAnswer>;
  rotating: Promise<RefreshAnswer>;
  /** The replay has read its token as spent and has not revoked yet. */
  replayRead: RaceGate;
  /** The rotation has read the successor as unspent and has not spent it yet. */
  rotationRead: RaceGate;
}

const INVALID_GRANT = expect.objectContaining({
  ok: false,
  error: OAUTH_ERROR.INVALID_GRANT,
});

describe('a replayed refresh token against a rotation of its successor', () => {
  let ctx: NativeOauthHarness;
  let restores: Array<() => void> = [];
  let gates: RaceGate[] = [];

  beforeAll(async () => {
    ctx = await startNativeOauth('native_refresh_replay_rotation');
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
    for (const restore of restores) {
      restore();
    }
    gates = [];
    restores = [];
  });

  /** Hold the replay and the legitimate rotation at their decisive write. */
  async function holdBoth(): Promise<HeldRace> {
    const granted = await issueNativeGrant(ctx);
    const successor = await rotate(ctx, granted.refreshToken);
    if (!successor.ok) {
      throw new Error('setup rotation failed');
    }
    const rotation = ctx.harness.app.get(NativeRefreshRotationService);
    const replayRead = new RaceGate();
    const rotationRead = new RaceGate();
    gates = [replayRead, rotationRead];
    restores = [
      holdBefore(rotation, 'replay', (call) =>
        call === 0 ? replayRead : undefined,
      ),
      holdBefore(rotation, 'claimAndRotate', (call) =>
        call === 0 ? rotationRead : undefined,
      ),
    ];

    const rotating = rotate(ctx, successor.refreshToken);
    await rotationRead.reached(1);
    const replaying = rotate(ctx, granted.refreshToken);
    await replayRead.reached(1);
    return {
      spentToken: granted.refreshToken,
      successorToken: successor.refreshToken,
      replaying,
      rotating,
      replayRead,
      rotationRead,
    };
  }

  async function familyState() {
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    if (!session) {
      throw new Error('expected a native session');
    }
    const credentials = await ctx.credentials
      .find({ sessionId: session._id })
      .lean()
      .exec();
    return {
      sessionValid: session.isValid,
      revokedReason: session.revokedReason,
      credentialCount: credentials.length,
      unspentCount: credentials.filter((row) => !row.spent).length,
      unrevokedCount: credentials.filter(
        (row) => !(row.revokedAt instanceof Date),
      ).length,
    };
  }

  it('has ended the family by the time the replay is answered, and the held rotation fails', async () => {
    const race = await holdBoth();

    race.replayRead.release();
    const replay = await race.replaying;
    const whenReplayAnswered = await familyState();
    race.rotationRead.release();
    const rotation = await race.rotating;

    expect({
      replay,
      whenReplayAnswered,
      rotation,
      afterwards: await familyState(),
      successorAfterwards: await rotate(ctx, race.successorToken),
    }).toEqual({
      replay: INVALID_GRANT,
      whenReplayAnswered: {
        sessionValid: false,
        revokedReason: SECURITY_EVENT_ACTION.REFRESH_REPLAYED,
        credentialCount: 4,
        unspentCount: 0,
        unrevokedCount: 0,
      },
      rotation: INVALID_GRANT,
      afterwards: {
        sessionValid: false,
        revokedReason: SECURITY_EVENT_ACTION.REFRESH_REPLAYED,
        credentialCount: 4,
        unspentCount: 0,
        unrevokedCount: 0,
      },
      successorAfterwards: INVALID_GRANT,
    });
  });

  it('ends the family, new pair included, when the rotation commits before the held replay', async () => {
    const race = await holdBoth();

    race.rotationRead.release();
    const rotation = await race.rotating;
    if (!rotation.ok) {
      throw new Error(`the rotation did not win: ${rotation.error}`);
    }
    const newPairWhileReplayHeld = (
      await ctx.credentials.findOne({
        tokenHash: hashToken(rotation.refreshToken),
      })
    )?.spent;
    race.replayRead.release();
    const replay = await race.replaying;

    expect({
      newPairWhileReplayHeld,
      replay,
      whenReplayAnswered: await familyState(),
      newPairAfterwards: await rotate(ctx, rotation.refreshToken),
    }).toEqual({
      newPairWhileReplayHeld: false,
      replay: INVALID_GRANT,
      whenReplayAnswered: {
        sessionValid: false,
        revokedReason: SECURITY_EVENT_ACTION.REFRESH_REPLAYED,
        credentialCount: 6,
        unspentCount: 0,
        unrevokedCount: 0,
      },
      newPairAfterwards: INVALID_GRANT,
    });
  });
});

function rotate(
  ctx: NativeOauthHarness,
  refreshToken: string,
): Promise<RefreshAnswer> {
  return ctx.tokens.grant(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: NATIVE_CLIENT_ID,
    },
    NATIVE_META,
  );
}

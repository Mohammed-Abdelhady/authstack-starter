import request from 'supertest';
import { NATIVE_DPOP_REVOKE_PATH } from '../../constants/session-policy';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import {
  issueNativeGrant,
  NATIVE_META,
  nativeHttpServer,
  NativeOauthHarness,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../persistence/mongo/harness/native-oauth.harness-spec';

const GRANT_EMAIL = 'native@example.com';

describe('native family revocation events', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_family_revocation_events');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  async function eventsFor(action: string) {
    const user = await ctx.harness.users
      .findOne({ email: GRANT_EMAIL })
      .orFail();
    const session = await ctx.harness.sessions
      .findOne({ user: user._id })
      .orFail();
    const events = await ctx.securityEvents.find({ action }).lean().exec();
    return {
      userId: user._id.toString(),
      sessionId: session._id.toString(),
      events: events.map(({ targetUserId, clientId, sessionId }) => ({
        targetUserId,
        clientId,
        sessionId,
      })),
    };
  }

  it('names the user and the client on a refresh replay', async () => {
    const granted = await issueNativeGrant(ctx);
    const refresh = {
      grant_type: 'refresh_token',
      refresh_token: granted.refreshToken,
      client_id: 'native-app',
    };
    await ctx.tokens.grant(refresh, NATIVE_META);

    const replay = await ctx.tokens.grant(refresh, NATIVE_META);

    const recorded = await eventsFor('refresh_replayed');
    expect(replay).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(recorded.events).toEqual([
      {
        targetUserId: recorded.userId,
        clientId: 'native-app',
        sessionId: recorded.sessionId,
      },
    ]);
  });

  it('names the user and the client on a client revoke', async () => {
    const granted = await issueNativeGrant(ctx);

    await request(nativeHttpServer(ctx.harness.app))
      .post(NATIVE_DPOP_REVOKE_PATH)
      .send({ token: granted.refreshToken, client_id: 'native-app' })
      .expect(200);

    const recorded = await eventsFor('native_client_revoked');
    expect(recorded.events).toEqual([
      {
        targetUserId: recorded.userId,
        clientId: 'native-app',
        sessionId: recorded.sessionId,
      },
    ]);
  });
});

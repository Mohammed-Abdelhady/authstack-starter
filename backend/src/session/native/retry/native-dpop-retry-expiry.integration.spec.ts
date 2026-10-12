import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import {
  DPOP_TEST_NONCE,
  signNativeDpopProof,
} from '../harness/native-dpop-test-vectors.harness-spec';
import {
  issueBoundNativeGrant,
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NativeOauthHarness,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../persistence/mongo/harness/native-oauth.harness-spec';
import { OAUTH_ERROR } from '../oauth/native-oauth.types';
import type { OauthFailure, TokenSuccess } from '../oauth/native-oauth.types';

const PRESENTED_REFRESH_EXPIRY = new Date('2099-01-01T12:00:00.001Z');
const BEFORE_PRESENTED_EXPIRY = new Date('2099-01-01T12:00:00.000Z');
const AT_PRESENTED_EXPIRY = new Date('2099-01-01T12:00:00.001Z');
const AFTER_PRESENTED_EXPIRY = new Date('2099-01-01T12:00:00.002Z');

describe('native DPoP spent-token expiry', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_dpop_retry_expiry');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('allows a retry one millisecond before the spent token expires', async () => {
    const refreshToken = await spentRefreshToken(ctx);
    await setPresentedExpiry(ctx, refreshToken);
    ctx.harness.clock.set(BEFORE_PRESENTED_EXPIRY);

    const result = await refresh(ctx, refreshToken, 'before-token-expiry');
    if (!result.ok) {
      throw new Error('retry before token expiry did not return a pair');
    }
    const credentials = await pairCredentials(ctx, result);
    const presented = await ctx.credentials
      .findOne({ tokenHash: hashToken(refreshToken) })
      .orFail()
      .exec();
    const session = await ctx.harness.sessions
      .findById(presented.sessionId)
      .orFail();

    expect(result.tokenType).toBe('Bearer');
    expect(credentials.map((credential) => credential.generation)).toEqual([
      2, 2,
    ]);
    expect(session.isValid).toBe(true);
  });

  it('ends the family when the spent token reaches its expiry', async () => {
    const refreshToken = await spentRefreshToken(ctx);
    await setPresentedExpiry(ctx, refreshToken);
    ctx.harness.clock.set(AT_PRESENTED_EXPIRY);

    const result = await refresh(ctx, refreshToken, 'at-token-expiry');
    const presented = await ctx.credentials
      .findOne({ tokenHash: hashToken(refreshToken) })
      .orFail()
      .exec();
    const session = await ctx.harness.sessions
      .findById(presented.sessionId)
      .orFail();

    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_GRANT,
    });
    expect(session.isValid).toBe(false);
    expect(session.revokedReason).toBe(SECURITY_EVENT_ACTION.REFRESH_REPLAYED);
  });

  it('ends the family one millisecond after the spent token expires', async () => {
    const refreshToken = await spentRefreshToken(ctx);
    await setPresentedExpiry(ctx, refreshToken);
    ctx.harness.clock.set(AFTER_PRESENTED_EXPIRY);

    const result = await refresh(ctx, refreshToken, 'after-token-expiry');
    const presented = await ctx.credentials
      .findOne({ tokenHash: hashToken(refreshToken) })
      .orFail()
      .exec();
    const session = await ctx.harness.sessions
      .findById(presented.sessionId)
      .orFail();

    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_GRANT,
    });
    expect(session.isValid).toBe(false);
    expect(session.revokedReason).toBe(SECURITY_EVENT_ACTION.REFRESH_REPLAYED);
  });
});

async function spentRefreshToken(ctx: NativeOauthHarness): Promise<string> {
  const initial = await issueBoundNativeGrant(ctx);
  const first = await refresh(
    ctx,
    initial.refreshToken,
    'first-expiry-rotation',
  );
  if (!first.ok) {
    throw new Error(`setup rotation failed: ${first.error}`);
  }
  const presented = await ctx.credentials
    .findOne({ tokenHash: hashToken(initial.refreshToken) })
    .orFail()
    .exec();
  expect(presented.spent).toBe(true);
  return initial.refreshToken;
}

async function setPresentedExpiry(
  ctx: NativeOauthHarness,
  refreshToken: string,
): Promise<void> {
  await ctx.credentials
    .updateOne(
      { tokenHash: hashToken(refreshToken) },
      { $set: { expiresAt: PRESENTED_REFRESH_EXPIRY } },
    )
    .exec();
  const presented = await ctx.credentials
    .findOne({ tokenHash: hashToken(refreshToken) })
    .orFail()
    .exec();
  expect(presented.expiresAt).toEqual(PRESENTED_REFRESH_EXPIRY);
}

async function pairCredentials(ctx: NativeOauthHarness, pair: TokenSuccess) {
  return ctx.credentials
    .find({
      tokenHash: {
        $in: [hashToken(pair.accessToken), hashToken(pair.refreshToken)],
      },
    })
    .exec();
}

function refresh(
  ctx: NativeOauthHarness,
  token: string,
  jti: string,
): Promise<TokenSuccess | OauthFailure> {
  return ctx.tokens.grant(
    {
      grant_type: 'refresh_token',
      refresh_token: token,
      client_id: NATIVE_CLIENT_ID,
    },
    NATIVE_META,
    signNativeDpopProof({
      token,
      claims: {
        iat: Math.floor(ctx.harness.clock.now().getTime() / 1000),
        jti,
        nonce: DPOP_TEST_NONCE,
      },
    }),
  );
}

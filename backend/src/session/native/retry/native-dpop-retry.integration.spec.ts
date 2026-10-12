import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import { NATIVE_DPOP_FAILURE_REASON } from '../../constants/session-policy';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  DPOP_TEST_NONCE,
  DPOP_TEST_PUBLIC_KEY_B,
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
import {
  OAUTH_ERROR,
  OauthFailure,
  TokenSuccess,
} from '../oauth/native-oauth.types';

const THUMBPRINT_A = 'cCnUK5OVvBfWAvjwdXAKfKdQaxTaqMdT7QNXypbdj6E';
const RETRY_TIME_INSIDE = new Date('2099-01-01T12:04:59.999Z');
const RETRY_TIME_OUTSIDE = new Date('2099-01-01T12:05:00.001Z');
const RETRY_IDLE_EXPIRY = new Date('2099-01-01T12:06:00.000Z');
const RETRY_NONCE_INSIDE =
  '67849204.Is-cdIYzUyHmaamD7Vh6J8OVyCV9ybkxlNIq58GByY0';
const RETRY_NONCE_OUTSIDE =
  '67849205.e0DK_bQfNKWZoMZiBWmuo1YO3_bD09Z6tUz3lqvFulM';

describe('native DPoP lost-answer retry', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_dpop_retry');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('replaces an unused successor pair at the same generation and keeps the family alive', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    const first = await successfulRefresh(
      ctx,
      initial.refreshToken,
      'first-rotation',
    );
    const replacement = await refresh(
      ctx,
      initial.refreshToken,
      proof(initial.refreshToken, 'lost-answer-retry'),
    );
    if (!replacement.ok) {
      throw new Error('lost-answer retry did not return a replacement pair');
    }
    const firstPair = await pairCredentials(ctx, first);
    const replacementPair = await pairCredentials(ctx, replacement);
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });

    expect(replacement).toMatchObject({ ok: true, tokenType: 'Bearer' });
    expect(replacementPair.map((row) => row.generation)).toEqual([2, 2]);
    expect(replacementPair.map((row) => row.proofKeyThumbprint)).toEqual([
      THUMBPRINT_A,
      THUMBPRINT_A,
    ]);
    expect(
      firstPair.every((row) => row.spent && row.revokedAt instanceof Date),
    ).toBe(true);
    expect(session?.isValid).toBe(true);
    expect(
      await ctx.securityEvents.countDocuments({
        action: SECURITY_EVENT_ACTION.NATIVE_DPOP_BOUND_RETRY,
      }),
    ).toBe(1);
    const secondRetry = await refresh(
      ctx,
      initial.refreshToken,
      proof(initial.refreshToken, 'lost-answer-second-retry'),
    );
    const stillValid = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    expect(secondRetry).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      error_description: NATIVE_DPOP_FAILURE_REASON.RETRY_IN_PROGRESS,
    });
    expect(replacementPair.every((row) => !row.spent && !row.revokedAt)).toBe(
      true,
    );
    expect(stillValid?.isValid).toBe(true);
    expect(
      await refresh(
        ctx,
        replacement.refreshToken,
        proof(replacement.refreshToken, 'replacement-works'),
      ),
    ).toMatchObject({ ok: true, tokenType: 'Bearer' });
  });

  it('allows a retry one millisecond inside the retry window', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    await successfulRefresh(ctx, initial.refreshToken, 'inside-first-rotation');
    await extendSessionIdleExpiry(ctx, initial.refreshToken);
    ctx.harness.clock.set(RETRY_TIME_INSIDE);

    const result = await refresh(
      ctx,
      initial.refreshToken,
      proof(
        initial.refreshToken,
        'inside-window-retry',
        RETRY_TIME_INSIDE,
        RETRY_NONCE_INSIDE,
      ),
    );
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });

    if (!result.ok) {
      throw new Error('retry inside the window did not return a pair');
    }
    expect(result.tokenType).toBe('Bearer');
    expect(
      (await pairCredentials(ctx, result)).map((row) => row.generation),
    ).toEqual([2, 2]);
    expect(session?.isValid).toBe(true);
  });

  it('ends the family one millisecond outside the retry window', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    await successfulRefresh(ctx, initial.refreshToken, 'window-first-rotation');
    await extendSessionIdleExpiry(ctx, initial.refreshToken);
    ctx.harness.clock.set(RETRY_TIME_OUTSIDE);

    const result = await refresh(
      ctx,
      initial.refreshToken,
      proof(
        initial.refreshToken,
        'window-expired-retry',
        RETRY_TIME_OUTSIDE,
        RETRY_NONCE_OUTSIDE,
      ),
    );
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_GRANT,
    });
    expect(session?.isValid).toBe(false);
    expect(session?.revokedReason).toBe(SECURITY_EVENT_ACTION.REFRESH_REPLAYED);
  });

  it('ends the family when the successor access credential was used', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    const first = await successfulRefresh(
      ctx,
      initial.refreshToken,
      'used-first-rotation',
    );
    expect(await ctx.access.validate(first.accessToken)).not.toBeNull();
    const access = await ctx.credentials
      .findOne({ tokenHash: hashToken(first.accessToken) })
      .orFail()
      .exec();

    const result = await refresh(
      ctx,
      initial.refreshToken,
      proof(initial.refreshToken, 'used-successor-retry'),
    );
    const session = await ctx.harness.sessions
      .findById(access.sessionId)
      .orFail();

    expect(access.firstUsedAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_GRANT,
    });
    expect(session.isValid).toBe(false);
    expect(session.revokedReason).toBe(SECURITY_EVENT_ACTION.REFRESH_REPLAYED);
  });

  it('ends the family when the successor refresh credential was used', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    const first = await successfulRefresh(
      ctx,
      initial.refreshToken,
      'used-refresh-first',
    );
    await successfulRefresh(ctx, first.refreshToken, 'used-refresh-successor');

    const result = await refresh(
      ctx,
      initial.refreshToken,
      proof(initial.refreshToken, 'used-refresh-retry'),
    );
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_GRANT,
    });
    expect(session?.isValid).toBe(false);
    expect(session?.revokedReason).toBe(SECURITY_EVENT_ACTION.REFRESH_REPLAYED);
  });

  it('refuses a foreign key retry without ending the family', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    await successfulRefresh(
      ctx,
      initial.refreshToken,
      'foreign-key-first-rotation',
    );
    const foreignProof = signNativeDpopProof({
      token: initial.refreshToken,
      signingKey: 'B',
      publicJwk: DPOP_TEST_PUBLIC_KEY_B,
      claims: { jti: 'foreign-key-retry' },
    });

    const result = await refresh(ctx, initial.refreshToken, foreignProof);
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      error_description: NATIVE_DPOP_FAILURE_REASON.KEY_MISMATCH,
    });
    expect(session?.isValid).toBe(true);
    expect(
      await ctx.securityEvents.countDocuments({
        action: SECURITY_EVENT_ACTION.NATIVE_DPOP_PROOF_REFUSED,
        reasonCode: NATIVE_DPOP_FAILURE_REASON.KEY_MISMATCH,
      }),
    ).toBe(1);
  });
});

async function successfulRefresh(
  ctx: NativeOauthHarness,
  token: string,
  jti: string,
): Promise<TokenSuccess> {
  const result = await refresh(ctx, token, proof(token, jti));
  if (!result.ok) {
    throw new Error(`refresh setup failed: ${result.error}`);
  }
  return result;
}

async function extendSessionIdleExpiry(
  ctx: NativeOauthHarness,
  refreshToken: string,
): Promise<void> {
  const credential = await ctx.credentials
    .findOne({ tokenHash: hashToken(refreshToken) })
    .orFail()
    .exec();
  await ctx.harness.sessions
    .updateOne(
      { _id: credential.sessionId },
      { $set: { idleExpiresAt: RETRY_IDLE_EXPIRY } },
    )
    .exec();
  const session = await ctx.harness.sessions
    .findById(credential.sessionId)
    .orFail();
  expect(session.idleExpiresAt).toEqual(RETRY_IDLE_EXPIRY);
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

function proof(
  token: string,
  jti: string,
  now = TEST_NOW,
  nonce = DPOP_TEST_NONCE,
): string {
  return signNativeDpopProof({
    token,
    claims: { iat: Math.floor(now.getTime() / 1000), jti, nonce },
  });
}

function refresh(
  ctx: NativeOauthHarness,
  token: string,
  dpopProof: string,
): Promise<TokenSuccess | OauthFailure> {
  return ctx.tokens.grant(
    {
      grant_type: 'refresh_token',
      refresh_token: token,
      client_id: NATIVE_CLIENT_ID,
    },
    NATIVE_META,
    dpopProof,
  );
}

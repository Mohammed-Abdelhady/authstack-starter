import { SecurityEventService } from '../../persistence/mongo/security-event.service';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import { NATIVE_DPOP_FAILURE_REASON } from '../../constants/session-policy';
import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { RaceGate, holdBefore } from '../../../../test/utils/race-gate';
import { NativeBoundRetryService } from './native-bound-retry.service';
import { signNativeDpopProof } from '../harness/native-dpop-test-vectors.harness-spec';
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

describe('native DPoP retry concurrency', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_dpop_retry_race');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('admits one replacement in two simultaneous retries and leaves the loser in progress', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    await successfulRefresh(ctx, initial.refreshToken, 'race-first-rotation');
    // Each retry has read the token as spent and unclaimed; neither has claimed.
    const firstRetry = new RaceGate();
    const secondRetry = new RaceGate();
    const restore = holdBefore(
      ctx.harness.app.get(NativeBoundRetryService),
      'retryOrReplay',
      (call) => [firstRetry, secondRetry][call],
    );
    let results: Array<TokenSuccess | OauthFailure> | undefined;
    try {
      const racers = [
        refresh(
          ctx,
          initial.refreshToken,
          signNativeDpopProof({
            token: initial.refreshToken,
            claims: { jti: 'retry-race-a' },
          }),
        ),
        refresh(
          ctx,
          initial.refreshToken,
          signNativeDpopProof({
            token: initial.refreshToken,
            claims: { jti: 'retry-race-b' },
          }),
        ),
      ];
      await firstRetry.reached(1);
      await secondRetry.reached(1);
      firstRetry.release();
      await Promise.race(racers);
      secondRetry.release();
      results = await Promise.all(racers);
    } finally {
      firstRetry.release();
      secondRetry.release();
      restore();
    }
    if (!results) {
      throw new Error('bound retry race did not run');
    }
    const successes = results.filter((result) => result.ok);
    const failures = results.filter((result) => !result.ok);
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    if (!session) {
      throw new Error('expected a native session');
    }
    const activeSuccessors = await ctx.credentials.countDocuments({
      sessionId: session._id,
      purpose: {
        $in: [
          CREDENTIAL_PURPOSE.NATIVE_ACCESS,
          CREDENTIAL_PURPOSE.NATIVE_REFRESH,
        ],
      },
      generation: 2,
      spent: false,
      revokedAt: { $exists: false },
    });

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      error_description: NATIVE_DPOP_FAILURE_REASON.RETRY_IN_PROGRESS,
    });
    expect(activeSuccessors).toBe(2);
    expect(session.isValid).toBe(true);
    expect(
      await ctx.securityEvents.countDocuments({
        action: SECURITY_EVENT_ACTION.NATIVE_DPOP_BOUND_RETRY,
      }),
    ).toBe(1);
  });

  it('does not mint duplicate pairs when the transaction body is retried', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    await successfulRefresh(
      ctx,
      initial.refreshToken,
      'transaction-first-rotation',
    );
    const events = ctx.harness.app.get(SecurityEventService);
    const record = events.record.bind(events);
    const transient = new Error('transient transaction failure');
    Object.defineProperty(transient, 'errorLabels', {
      value: ['TransientTransactionError'],
    });
    let attempts = 0;
    const eventSpy = jest
      .spyOn(events, 'record')
      .mockImplementation(async (input, session) => {
        if (
          input.action === SECURITY_EVENT_ACTION.NATIVE_DPOP_BOUND_RETRY &&
          attempts === 0
        ) {
          attempts += 1;
          throw transient;
        }
        return record(input, session);
      });
    let replacement: TokenSuccess | OauthFailure;
    try {
      replacement = await refresh(
        ctx,
        initial.refreshToken,
        signNativeDpopProof({
          token: initial.refreshToken,
          claims: { jti: 'transaction-retry-safe' },
        }),
      );
    } finally {
      eventSpy.mockRestore();
    }
    if (!replacement.ok) {
      throw new Error('transaction retry did not return a replacement pair');
    }
    const source = await ctx.credentials
      .findOne({ tokenHash: hashToken(initial.refreshToken) })
      .orFail()
      .exec();
    const generationTwo = await ctx.credentials.countDocuments({
      sessionId: source.sessionId,
      generation: 2,
    });

    expect(attempts).toBe(1);
    expect(generationTwo).toBe(4);
    expect(source.successorAccessHash).toBe(hashToken(replacement.accessToken));
    expect(source.successorRefreshHash).toBe(
      hashToken(replacement.refreshToken),
    );
    expect(
      await ctx.securityEvents.countDocuments({
        action: SECURITY_EVENT_ACTION.NATIVE_DPOP_BOUND_RETRY,
      }),
    ).toBe(1);
  });
});

async function successfulRefresh(
  ctx: NativeOauthHarness,
  token: string,
  jti: string,
): Promise<TokenSuccess> {
  const result = await refresh(
    ctx,
    token,
    signNativeDpopProof({
      token,
      claims: { jti },
    }),
  );
  if (!result.ok) {
    throw new Error(`refresh setup failed: ${result.error}`);
  }
  return result;
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

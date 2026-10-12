import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import {
  NATIVE_DPOP_FAILURE_REASON,
  NATIVE_DPOP_PROOF_HEADER,
  NATIVE_DPOP_TOKEN_PATH,
} from '../../constants/session-policy';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  approveNativeCode,
  ApprovedNativeCode,
  issueNativeGrant,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
  NATIVE_META,
  nativeHttpServer,
  NativeOauthHarness,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../persistence/mongo/harness/native-oauth.harness-spec';
import { signNativeDpopProof } from '../harness/native-dpop-test-vectors.harness-spec';
import { OAUTH_ERROR, TokenSuccess } from '../oauth/native-oauth.types';

async function approvedCode(
  ctx: NativeOauthHarness,
  email: string,
): Promise<ApprovedNativeCode> {
  const user = await createTestUser(ctx.harness.users, email);
  return approveNativeCode(ctx, user);
}

async function issueUnboundGrant(
  ctx: NativeOauthHarness,
): Promise<TokenSuccess> {
  const config = ctx.harness.app.get(ConfigService);
  config.set('auth.nativeDpopRequired', false);
  try {
    return await issueNativeGrant(ctx);
  } finally {
    config.set('auth.nativeDpopRequired', true);
  }
}

function exchange(
  ctx: NativeOauthHarness,
  approved: ApprovedNativeCode,
  proof?: string,
) {
  let call = request(nativeHttpServer(ctx.harness.app))
    .post(NATIVE_DPOP_TOKEN_PATH)
    .send({
      grant_type: 'authorization_code',
      code: approved.code,
      redirect_uri: NATIVE_REDIRECT,
      client_id: NATIVE_CLIENT_ID,
      code_verifier: approved.verifier,
    });
  if (proof !== undefined) {
    call = call.set(NATIVE_DPOP_PROOF_HEADER, proof);
  }
  return call;
}

describe('native DPoP required mode', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_dpop_required', {
      nativeDpopRequired: true,
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('refuses an exchange without proof and leaves the code usable for a bound exchange', async () => {
    const approved = await approvedCode(ctx, 'required-exchange@example.com');
    const refused = await exchange(ctx, approved);
    const transaction = await ctx.transactions
      .findOne({ transactionId: approved.transactionId })
      .orFail()
      .exec();

    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      error_description: NATIVE_DPOP_FAILURE_REASON.REQUIRED,
    });
    expect(transaction.consumed).toBe(false);
    expect(await ctx.credentials.countDocuments()).toBe(0);

    const accepted = await exchange(
      ctx,
      approved,
      signNativeDpopProof({ claims: { jti: 'required-exchange-bound' } }),
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.token_type).toBe('Bearer');
  });

  it('refuses unbound refresh without spending the token or ending its family', async () => {
    const granted = await issueUnboundGrant(ctx);
    const result = await ctx.tokens.grant(
      {
        grant_type: 'refresh_token',
        refresh_token: granted.refreshToken,
        client_id: NATIVE_CLIENT_ID,
      },
      NATIVE_META,
    );
    const refresh = await ctx.credentials
      .findOne({ tokenHash: hashToken(granted.refreshToken) })
      .orFail()
      .exec();
    const session = await ctx.harness.sessions
      .findById(refresh.sessionId)
      .orFail();

    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      error_description: NATIVE_DPOP_FAILURE_REASON.REQUIRED,
    });
    expect(refresh.spent).toBe(false);
    expect(session.isValid).toBe(true);
    expect(await ctx.proofIds.countDocuments()).toBe(0);
  });

  it('does not bind an unbound family when a proof header is present', async () => {
    const granted = await issueUnboundGrant(ctx);
    const proof = signNativeDpopProof({
      token: granted.refreshToken,
      claims: {
        iat: Math.floor(TEST_NOW.getTime() / 1000),
        jti: 'required-unbound-header',
      },
    });
    const result = await ctx.tokens.grant(
      {
        grant_type: 'refresh_token',
        refresh_token: granted.refreshToken,
        client_id: NATIVE_CLIENT_ID,
      },
      NATIVE_META,
      proof,
    );

    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      error_description: NATIVE_DPOP_FAILURE_REASON.REQUIRED,
    });
    expect(await ctx.proofIds.countDocuments()).toBe(0);
    expect(
      await ctx.credentials.countDocuments({
        proofKeyThumbprint: { $exists: true },
      }),
    ).toBe(0);
  });
});

describe('native DPoP optional mode', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_dpop_optional', {
      nativeDpopRequired: false,
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('keeps an exchange without proof as Bearer', async () => {
    const approved = await approvedCode(ctx, 'optional-exchange@example.com');
    const response = await exchange(ctx, approved);

    expect(response.status).toBe(200);
    expect(response.body.token_type).toBe('Bearer');
  });

  it('ignores proof on an unbound refresh and does not bind the new pair', async () => {
    const granted = await issueNativeGrant(ctx);
    const proof = signNativeDpopProof({
      token: granted.refreshToken,
      claims: {
        iat: Math.floor(TEST_NOW.getTime() / 1000),
        jti: 'optional-unbound-header',
      },
    });
    const result = await ctx.tokens.grant(
      {
        grant_type: 'refresh_token',
        refresh_token: granted.refreshToken,
        client_id: NATIVE_CLIENT_ID,
      },
      NATIVE_META,
      proof,
    );
    if (!result.ok) {
      throw new Error(`unbound refresh failed: ${result.error}`);
    }
    const pair = await ctx.credentials
      .find({
        tokenHash: {
          $in: [hashToken(result.accessToken), hashToken(result.refreshToken)],
        },
      })
      .exec();

    expect(result.tokenType).toBe('Bearer');
    expect(pair.map((credential) => credential.proofKeyThumbprint)).toEqual([
      undefined,
      undefined,
    ]);
    expect(await ctx.proofIds.countDocuments()).toBe(0);
  });
});

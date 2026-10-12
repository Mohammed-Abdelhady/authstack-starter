import request from 'supertest';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import {
  NATIVE_DPOP_FAILURE_REASON,
  NATIVE_DPOP_PROOF_HEADER,
  NATIVE_DPOP_TOKEN_PATH,
} from '../../constants/session-policy';
import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { OAUTH_ERROR } from '../oauth/native-oauth.types';
import {
  issueBoundNativeGrant,
  NATIVE_CLIENT_ID,
  nativeHttpServer,
  NativeOauthHarness,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../persistence/mongo/harness/native-oauth.harness-spec';
import {
  DPOP_TEST_NONCE,
  DPOP_TEST_PUBLIC_KEY_B,
  signNativeDpopProof,
} from '../harness/native-dpop-test-vectors.harness-spec';

const THUMBPRINT_A = 'cCnUK5OVvBfWAvjwdXAKfKdQaxTaqMdT7QNXypbdj6E';
const DPOP_REFUSAL_ACTION = SECURITY_EVENT_ACTION.NATIVE_DPOP_PROOF_REFUSED;

function refreshRequest(
  ctx: NativeOauthHarness,
  token: string,
  proof?: string,
) {
  let call = request(nativeHttpServer(ctx.harness.app))
    .post(NATIVE_DPOP_TOKEN_PATH)
    .send({
      grant_type: 'refresh_token',
      refresh_token: token,
      client_id: NATIVE_CLIENT_ID,
    });
  if (proof !== undefined) {
    call = call.set(NATIVE_DPOP_PROOF_HEADER, proof);
  }
  return call;
}

function validRefreshProof(token: string, jti: string): string {
  return signNativeDpopProof({ token, claims: { jti } });
}

function invalidSignature(proof: string): string {
  const separator = proof.lastIndexOf('.');
  const signature = proof.slice(separator + 1);
  const replacement = signature[0] === 'A' ? 'B' : 'A';
  return `${proof.slice(0, separator + 1)}${replacement}${signature.slice(1)}`;
}

function responseToken(
  response: { body: unknown },
  field: 'access_token' | 'refresh_token',
): string {
  const body = response.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('token response body was malformed');
  }
  const token: unknown = Reflect.get(body, field);
  if (typeof token !== 'string') {
    throw new Error(`token response did not include ${field}`);
  }
  return token;
}

async function expectRefusal(
  ctx: NativeOauthHarness,
  token: string,
  proof: string | undefined,
  reason: string,
  oauthError: string = OAUTH_ERROR.INVALID_DPOP_PROOF,
  nonce?: string,
): Promise<void> {
  const before = await ctx.credentials
    .findOne({ tokenHash: hashToken(token) })
    .orFail()
    .exec();
  const session = await ctx.harness.sessions
    .findById(before.sessionId)
    .orFail();
  const proofCount = await ctx.proofIds.countDocuments();
  const response = await refreshRequest(ctx, token, proof);
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({
    error: oauthError,
    error_description: reason,
  });
  if (nonce !== undefined) {
    expect(response.headers['dpop-nonce']).toBe(nonce);
  }
  const after = await ctx.credentials.findById(before._id).orFail().exec();
  expect(after.spent).toBe(before.spent);
  expect(
    (await ctx.harness.sessions.findById(session._id).orFail()).isValid,
  ).toBe(true);
  expect(await ctx.proofIds.countDocuments()).toBe(proofCount);
  const event = await ctx.securityEvents
    .findOne({
      action: DPOP_REFUSAL_ACTION,
      reasonCode: reason,
      sessionId: session._id.toString(),
    })
    .exec();
  expect(event?.targetUserId).toBe(session.user.toString());
  expect(event?.sessionId).toBe(session._id.toString());
}

describe('native DPoP bound refresh', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_dpop_refresh');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('rotates a bound pair and preserves its thumbprint on both new credentials', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    const old = await ctx.credentials
      .findOne({ tokenHash: hashToken(initial.refreshToken) })
      .orFail()
      .exec();

    const response = await refreshRequest(
      ctx,
      initial.refreshToken,
      validRefreshProof(initial.refreshToken, 'bound-refresh-success'),
    );
    const issued = await ctx.credentials
      .find({
        tokenHash: {
          $in: [
            hashToken(responseToken(response, 'access_token')),
            hashToken(responseToken(response, 'refresh_token')),
          ],
        },
      })
      .exec();
    const session = await ctx.harness.sessions.findById(old.sessionId).orFail();

    expect(response.status).toBe(200);
    expect(response.body.token_type).toBe('Bearer');
    expect(old.generation).toBe(1);
    expect(issued.map((credential) => credential.generation)).toEqual([2, 2]);
    expect(issued.map((credential) => credential.proofKeyThumbprint)).toEqual([
      THUMBPRINT_A,
      THUMBPRINT_A,
    ]);
    expect(session.proofKeyThumbprint).toBe(THUMBPRINT_A);
    expect((await ctx.credentials.findById(old._id).orFail()).spent).toBe(true);
  });

  it('refuses missing, malformed-signature, foreign-key, and wrong-ath proofs without spending the token', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    await expectRefusal(
      ctx,
      initial.refreshToken,
      undefined,
      NATIVE_DPOP_FAILURE_REASON.PROOF_REQUIRED,
    );
    await expectRefusal(
      ctx,
      initial.refreshToken,
      invalidSignature(
        validRefreshProof(initial.refreshToken, 'bad-signature'),
      ),
      NATIVE_DPOP_FAILURE_REASON.PROOF_SIGNATURE_INVALID,
    );
    await expectRefusal(
      ctx,
      initial.refreshToken,
      signNativeDpopProof({
        token: initial.refreshToken,
        signingKey: 'B',
        publicJwk: DPOP_TEST_PUBLIC_KEY_B,
        claims: { jti: 'foreign-refresh-key' },
      }),
      NATIVE_DPOP_FAILURE_REASON.KEY_MISMATCH,
    );
    await expectRefusal(
      ctx,
      initial.refreshToken,
      signNativeDpopProof({
        token: 'another-refresh-token',
        claims: { jti: 'wrong-refresh-ath' },
      }),
      NATIVE_DPOP_FAILURE_REASON.PROOF_ATH_INVALID,
    );
  });

  it('challenges missing and stale nonces, then accepts the same unspent token', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    await expectRefusal(
      ctx,
      initial.refreshToken,
      signNativeDpopProof({
        token: initial.refreshToken,
        claims: { jti: 'missing-refresh-nonce', nonce: undefined },
      }),
      NATIVE_DPOP_FAILURE_REASON.NONCE_REQUIRED,
      OAUTH_ERROR.USE_DPOP_NONCE,
      DPOP_TEST_NONCE,
    );
    const later = new Date(TEST_NOW.getTime() + 120_000);
    const freshNonce = '67849202.-AYZXudDvC0-IGf2J-KYTbs1Orqm_npnDNoTCg1IKUI';
    ctx.harness.clock.set(later);
    await expectRefusal(
      ctx,
      initial.refreshToken,
      signNativeDpopProof({
        token: initial.refreshToken,
        claims: {
          iat: Math.floor(later.getTime() / 1000),
          jti: 'stale-refresh-nonce',
          nonce: DPOP_TEST_NONCE,
        },
      }),
      NATIVE_DPOP_FAILURE_REASON.NONCE_INVALID,
      OAUTH_ERROR.USE_DPOP_NONCE,
      freshNonce,
    );

    const accepted = await refreshRequest(
      ctx,
      initial.refreshToken,
      signNativeDpopProof({
        token: initial.refreshToken,
        claims: {
          iat: Math.floor(later.getTime() / 1000),
          jti: 'fresh-refresh-nonce',
          nonce: freshNonce,
        },
      }),
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.token_type).toBe('Bearer');
  });

  it('allows the bound app to rotate after a refresh-token thief has no key', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    await expectRefusal(
      ctx,
      initial.refreshToken,
      undefined,
      NATIVE_DPOP_FAILURE_REASON.PROOF_REQUIRED,
    );
    const accepted = await refreshRequest(
      ctx,
      initial.refreshToken,
      validRefreshProof(initial.refreshToken, 'real-app-refresh'),
    );

    expect(accepted.status).toBe(200);
    expect(accepted.body.token_type).toBe('Bearer');
  });

  it('uses the session thumbprint when a bound credential has no thumbprint field', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    await ctx.credentials.updateOne(
      { tokenHash: hashToken(initial.refreshToken) },
      { $unset: { proofKeyThumbprint: 1 } },
    );

    const response = await refreshRequest(
      ctx,
      initial.refreshToken,
      validRefreshProof(initial.refreshToken, 'missing-credential-thumbprint'),
    );
    const newRefresh = await ctx.credentials
      .findOne({
        tokenHash: hashToken(responseToken(response, 'refresh_token')),
      })
      .orFail()
      .exec();

    expect(response.status).toBe(200);
    expect(response.body.token_type).toBe('Bearer');
    expect(newRefresh.proofKeyThumbprint).toBe(THUMBPRINT_A);
    expect(newRefresh.purpose).toBe(CREDENTIAL_PURPOSE.NATIVE_REFRESH);
  });

  it('refuses a reused proof id without spending the current token or ending the family', async () => {
    const initial = await issueBoundNativeGrant(ctx);
    const first = await refreshRequest(
      ctx,
      initial.refreshToken,
      validRefreshProof(initial.refreshToken, 'reused-refresh-proof-id'),
    );
    const successorToken = responseToken(first, 'refresh_token');
    const eventCount = await ctx.proofIds.countDocuments();

    await expectRefusal(
      ctx,
      successorToken,
      validRefreshProof(successorToken, 'reused-refresh-proof-id'),
      NATIVE_DPOP_FAILURE_REASON.PROOF_REPLAYED,
    );
    expect(await ctx.proofIds.countDocuments()).toBe(eventCount);
  });
});

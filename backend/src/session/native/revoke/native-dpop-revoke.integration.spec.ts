import request from 'supertest';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import {
  NATIVE_DPOP_FAILURE_REASON,
  NATIVE_DPOP_PROOF_HEADER,
  NATIVE_DPOP_REVOKE_PATH,
} from '../../constants/session-policy';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  DPOP_TEST_NONCE,
  signNativeDpopProof,
} from '../harness/native-dpop-test-vectors.harness-spec';
import {
  issueBoundNativeGrant,
  issueNativeGrant,
  NATIVE_CLIENT_ID,
  nativeHttpServer,
  NativeOauthHarness,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../persistence/mongo/harness/native-oauth.harness-spec';
import { OAUTH_ERROR } from '../oauth/native-oauth.types';

const REVOKE_ADDRESS = 'https://api.example.test/api/oauth/revoke';

function revokeRequest(ctx: NativeOauthHarness, token: string, proof?: string) {
  let call = request(nativeHttpServer(ctx.harness.app))
    .post(NATIVE_DPOP_REVOKE_PATH)
    .send({ token, client_id: NATIVE_CLIENT_ID });
  if (proof !== undefined) {
    call = call.set(NATIVE_DPOP_PROOF_HEADER, proof);
  }
  return call;
}

function boundProof(token: string, jti: string): string {
  return signNativeDpopProof({
    token,
    claims: {
      htu: REVOKE_ADDRESS,
      iat: Math.floor(TEST_NOW.getTime() / 1000),
      jti,
      nonce: DPOP_TEST_NONCE,
    },
  });
}

describe('native DPoP revoke', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_dpop_revoke');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('keeps a bound family alive after missing proof, then revokes it with its key', async () => {
    const granted = await issueBoundNativeGrant(ctx);
    const credential = await ctx.credentials
      .findOne({ tokenHash: hashToken(granted.accessToken) })
      .orFail()
      .exec();
    const refused = await revokeRequest(ctx, granted.accessToken);
    const sessionAfterRefusal = await ctx.harness.sessions
      .findById(credential.sessionId)
      .orFail();

    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      error_description: NATIVE_DPOP_FAILURE_REASON.PROOF_REQUIRED,
    });
    expect(sessionAfterRefusal.isValid).toBe(true);
    expect(
      await ctx.securityEvents.countDocuments({
        action: SECURITY_EVENT_ACTION.NATIVE_DPOP_PROOF_REFUSED,
        reasonCode: NATIVE_DPOP_FAILURE_REASON.PROOF_REQUIRED,
        targetUserId: sessionAfterRefusal.user.toString(),
        sessionId: sessionAfterRefusal._id.toString(),
      }),
    ).toBe(1);
    expect(await ctx.proofIds.countDocuments()).toBe(1);

    const revoked = await revokeRequest(
      ctx,
      granted.accessToken,
      boundProof(granted.accessToken, 'bound-revoke-proof'),
    );
    const sessionAfterRevoke = await ctx.harness.sessions
      .findById(credential.sessionId)
      .orFail();

    expect(revoked.status).toBe(200);
    expect(revoked.body).toEqual({});
    expect(sessionAfterRevoke.isValid).toBe(false);
    expect(sessionAfterRevoke.revokedReason).toBe(
      SECURITY_EVENT_ACTION.NATIVE_CLIENT_REVOKED,
    );
    expect(await ctx.proofIds.countDocuments()).toBe(2);
  });

  it('revokes an unbound family without a proof', async () => {
    const granted = await issueNativeGrant(ctx);
    const response = await revokeRequest(ctx, granted.accessToken);
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });

    expect(response.status).toBe(200);
    expect(session?.isValid).toBe(false);
    expect(session?.revokedReason).toBe(
      SECURITY_EVENT_ACTION.NATIVE_CLIENT_REVOKED,
    );
    expect(await ctx.proofIds.countDocuments()).toBe(0);
  });

  it('ignores a malformed DPoP header for an unbound family', async () => {
    const granted = await issueNativeGrant(ctx);
    const response = await revokeRequest(
      ctx,
      granted.accessToken,
      'not-a-compact-proof',
    );
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });

    expect(response.status).toBe(200);
    expect(session?.isValid).toBe(false);
    expect(await ctx.proofIds.countDocuments()).toBe(0);
  });
});

import request from 'supertest';
import { SECURITY_EVENT_ACTION } from '../../constants/security-event-action';
import { NATIVE_DPOP_PROOF_HEADER } from '../../constants/session-policy';
import {
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { OAUTH_ERROR } from '../oauth/native-oauth.types';
import {
  ApprovedNativeCode,
  approveNativeCode,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
  NativeOauthHarness,
  nativeHttpServer,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../persistence/mongo/harness/native-oauth.harness-spec';
import {
  DPOP_TEST_NONCE,
  signNativeDpopProof,
} from '../harness/native-dpop-test-vectors.harness-spec';

const CURRENT_NONCE = '67849200.D39EiUXtZzXo9pMNtusjSjClHXRY81m6xmkomp9li74';
const THUMBPRINT_A = 'cCnUK5OVvBfWAvjwdXAKfKdQaxTaqMdT7QNXypbdj6E';
const DPOP_REFUSAL_ACTION = SECURITY_EVENT_ACTION.NATIVE_DPOP_PROOF_REFUSED;

function exchangeCode(
  ctx: NativeOauthHarness,
  approved: ApprovedNativeCode,
  proof?: string,
  requestHeaders: Record<string, string> = {},
) {
  let exchange = request(nativeHttpServer(ctx.harness.app))
    .post('/api/oauth/token')
    .send({
      grant_type: 'authorization_code',
      code: approved.code,
      redirect_uri: NATIVE_REDIRECT,
      client_id: NATIVE_CLIENT_ID,
      code_verifier: approved.verifier,
    });
  if (proof !== undefined) {
    exchange = exchange.set(NATIVE_DPOP_PROOF_HEADER, proof);
  }
  for (const [name, value] of Object.entries(requestHeaders)) {
    exchange = exchange.set(name, value);
  }
  return exchange;
}

async function approvedCode(
  ctx: NativeOauthHarness,
  email: string,
): Promise<ApprovedNativeCode> {
  const user = await createTestUser(ctx.harness.users, email);
  return approveNativeCode(ctx, user);
}

function findApprovedTransaction(
  ctx: NativeOauthHarness,
  approved: ApprovedNativeCode,
) {
  return ctx.transactions
    .findOne({ transactionId: approved.transactionId })
    .exec();
}

describe('native DPoP authorization-code exchange', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_dpop_exchange');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  });

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('keeps an exchange without DPoP as Bearer and leaves all records unbound', async () => {
    const approved = await approvedCode(ctx, 'dpop-bearer@example.com');
    const response = await exchangeCode(ctx, approved);
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    const credentials = await ctx.credentials
      .find({ sessionId: session?._id })
      .sort({ purpose: 1 })
      .exec();

    expect(response.status).toBe(200);
    expect(response.body.token_type).toBe('Bearer');
    expect(session?.proofKeyThumbprint).toBeUndefined();
    expect(
      credentials.map((credential) => credential.proofKeyThumbprint),
    ).toEqual([undefined, undefined]);
    expect(await ctx.proofIds.countDocuments()).toBe(0);
  });

  it('challenges for a nonce, then issues a DPoP-bound pair from the same code', async () => {
    const approved = await approvedCode(ctx, 'dpop-bound@example.com');
    const challenged = await exchangeCode(
      ctx,
      approved,
      signNativeDpopProof({ claims: { nonce: undefined } }),
    );

    expect(challenged.status).toBe(400);
    expect(challenged.body).toEqual({
      error: 'use_dpop_nonce',
      error_description: 'NATIVE_DPOP_NONCE_REQUIRED',
    });
    expect(challenged.headers['dpop-nonce']).toBe(CURRENT_NONCE);
    expect((await findApprovedTransaction(ctx, approved))?.consumed).toBe(
      false,
    );
    expect(await ctx.proofIds.countDocuments()).toBe(0);

    const bound = await exchangeCode(ctx, approved, signNativeDpopProof());
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    const credentials = await ctx.credentials
      .find({ sessionId: session?._id })
      .sort({ purpose: 1 })
      .exec();

    expect(bound.status).toBe(200);
    expect(bound.body.token_type).toBe('Bearer');
    expect(session?.proofKeyThumbprint).toBe(THUMBPRINT_A);
    expect(
      credentials.map((credential) => credential.proofKeyThumbprint),
    ).toEqual([THUMBPRINT_A, THUMBPRINT_A]);
    expect(await ctx.proofIds.countDocuments()).toBe(1);
    expect(
      await ctx.securityEvents.countDocuments({
        action: DPOP_REFUSAL_ACTION,
        reasonCode: 'NATIVE_DPOP_NONCE_REQUIRED',
      }),
    ).toBe(1);
  });

  it('uses the configured API origin despite forged Host and X-Forwarded-Host', async () => {
    const approved = await approvedCode(ctx, 'dpop-host@example.com');
    const forgedHostProof = signNativeDpopProof({
      claims: { htu: 'https://forged.example/api/oauth/token' },
    });
    const refused = await exchangeCode(ctx, approved, forgedHostProof, {
      Host: 'forged.example',
      'X-Forwarded-Host': 'forged.example',
    });

    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(OAUTH_ERROR.INVALID_DPOP_PROOF);
    expect(refused.body.error_description).toBe(
      'NATIVE_DPOP_PROOF_ADDRESS_MISMATCH',
    );
    expect(await ctx.proofIds.countDocuments()).toBe(0);

    const accepted = await exchangeCode(ctx, approved, signNativeDpopProof(), {
      Host: 'forged.example',
      'X-Forwarded-Host': 'forged.example',
    });

    expect(accepted.status).toBe(200);
    expect(accepted.body.token_type).toBe('Bearer');
    expect(
      await ctx.securityEvents.countDocuments({ action: DPOP_REFUSAL_ACTION }),
    ).toBe(1);
  });

  it('keeps a pending code usable after a refused proof and records events only for pending codes', async () => {
    expect(
      await ctx.securityEvents.countDocuments({ action: DPOP_REFUSAL_ACTION }),
    ).toBe(0);
    const approved = await approvedCode(ctx, 'dpop-retry@example.com');
    const refused = await exchangeCode(ctx, approved, 'malformed-proof');

    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe(OAUTH_ERROR.INVALID_DPOP_PROOF);
    expect(refused.body.error_description).toBe('NATIVE_DPOP_PROOF_MALFORMED');
    expect((await findApprovedTransaction(ctx, approved))?.consumed).toBe(
      false,
    );
    expect(
      await ctx.securityEvents.countDocuments({
        action: DPOP_REFUSAL_ACTION,
        reasonCode: 'NATIVE_DPOP_PROOF_MALFORMED',
      }),
    ).toBe(1);

    const unknownCode = {
      ...approved,
      code: 'not-a-pending-code',
    };
    const anonymousRefusal = await exchangeCode(
      ctx,
      unknownCode,
      'malformed-proof',
    );

    expect(anonymousRefusal.status).toBe(400);
    expect(anonymousRefusal.body.error).toBe(OAUTH_ERROR.INVALID_DPOP_PROOF);
    expect(
      await ctx.securityEvents.countDocuments({ action: DPOP_REFUSAL_ACTION }),
    ).toBe(1);

    const unknownCodeWithValidProof = await exchangeCode(
      ctx,
      unknownCode,
      signNativeDpopProof(),
    );
    expect(unknownCodeWithValidProof.status).toBe(400);
    expect(unknownCodeWithValidProof.body.error).toBe(
      OAUTH_ERROR.INVALID_GRANT,
    );
    expect(
      await ctx.securityEvents.countDocuments({ action: DPOP_REFUSAL_ACTION }),
    ).toBe(1);

    const accepted = await exchangeCode(ctx, approved, signNativeDpopProof());
    expect(accepted.status).toBe(200);
    expect(accepted.body.token_type).toBe('Bearer');

    const consumedReplay = await exchangeCode(
      ctx,
      approved,
      signNativeDpopProof(),
    );
    expect(consumedReplay.status).toBe(400);
    expect(consumedReplay.body.error).toBe(OAUTH_ERROR.INVALID_GRANT);
    expect(
      await ctx.securityEvents.countDocuments({ action: DPOP_REFUSAL_ACTION }),
    ).toBe(1);

    const expired = await approvedCode(ctx, 'dpop-expired-event@example.com');
    ctx.harness.clock.set(new Date(TEST_NOW.getTime() + 60_001));
    const expiredRefusal = await exchangeCode(ctx, expired, 'malformed-proof');

    expect(expiredRefusal.status).toBe(400);
    expect(expiredRefusal.body.error).toBe(OAUTH_ERROR.INVALID_DPOP_PROOF);
    expect(expiredRefusal.body.error_description).toBe(
      'NATIVE_DPOP_PROOF_MALFORMED',
    );
    expect(
      await ctx.securityEvents.countDocuments({ action: DPOP_REFUSAL_ACTION }),
    ).toBe(1);
  });

  it('returns a fresh nonce for a stale nonce and leaves the code usable', async () => {
    const approved = await approvedCode(ctx, 'dpop-stale-nonce@example.com');
    const later = new Date(TEST_NOW.getTime() + 120_000);
    const freshNonce = '67849202.-AYZXudDvC0-IGf2J-KYTbs1Orqm_npnDNoTCg1IKUI';
    ctx.harness.clock.set(later);

    const refused = await exchangeCode(
      ctx,
      approved,
      signNativeDpopProof({
        claims: {
          iat: Math.floor(later.getTime() / 1000),
          nonce: DPOP_TEST_NONCE,
        },
      }),
    );

    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({
      error: 'use_dpop_nonce',
      error_description: 'NATIVE_DPOP_NONCE_INVALID',
    });
    expect(refused.headers['dpop-nonce']).toBe(freshNonce);
    expect((await findApprovedTransaction(ctx, approved))?.consumed).toBe(
      false,
    );
    expect(await ctx.proofIds.countDocuments()).toBe(0);
  });

  it('stores only the proof id hash with a bounded lifetime and both indexes', async () => {
    const approved = await approvedCode(ctx, 'dpop-indexes@example.com');
    const response = await exchangeCode(ctx, approved, signNativeDpopProof());
    const stored = await ctx.proofIds.findOne().orFail().exec();
    const indexes = await ctx.proofIds.collection.indexes();

    expect(response.status).toBe(200);
    expect(stored?.proofIdHash).toBe(
      '2c4f41258fcda88b9d43d883a7b7dbb6c7c477793ba106b68d110638d94c0d73',
    );
    expect(stored?.expiresAt.getTime() - TEST_NOW.getTime()).toBe(150_000);
    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'native_dpop_proof_id_unique',
          key: { proofIdHash: 1 },
          unique: true,
        }),
        expect.objectContaining({
          key: { expiresAt: 1 },
          expireAfterSeconds: 0,
        }),
      ]),
    );
  });

  it('does not reserve a proof id when the authorization authority is stale', async () => {
    const approved = await approvedCode(ctx, 'dpop-authority@example.com');
    const transaction = await findApprovedTransaction(ctx, approved);
    await ctx.harness.grants.updateOne(
      { userId: transaction?.userId, clientId: NATIVE_CLIENT_ID },
      { $set: { allowed: false } },
    );

    const response = await exchangeCode(ctx, approved, signNativeDpopProof());

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_grant');
    expect(await ctx.proofIds.countDocuments()).toBe(0);
    expect(await ctx.credentials.countDocuments()).toBe(0);
  });

  it('admits one of two codes using the same proof id and reports replay to the loser', async () => {
    const first = await approvedCode(ctx, 'dpop-race-one@example.com');
    const second = await approvedCode(ctx, 'dpop-race-two@example.com');
    const proof = signNativeDpopProof();
    const [firstResponse, secondResponse] = await Promise.all([
      exchangeCode(ctx, first, proof),
      exchangeCode(ctx, second, proof),
    ]);
    const responses = [firstResponse, secondResponse];
    const winner = responses.find((response) => response.status === 200);
    const loser = responses.find((response) => response.status !== 200);

    expect(winner?.body.token_type).toBe('Bearer');
    expect(loser?.status).toBe(400);
    expect(loser?.body).toEqual({
      error: OAUTH_ERROR.INVALID_DPOP_PROOF,
      error_description: 'NATIVE_DPOP_PROOF_REPLAYED',
    });
    expect(await ctx.proofIds.countDocuments()).toBe(1);
  });
});

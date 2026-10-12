import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import {
  DEFAULT_API_AUDIENCE,
  WEB_CLIENT_ID,
} from '../../constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import {
  AUTH_SCHEMA_VERSION,
  MAX_SESSIONS_PER_USER,
} from '../../constants/session-policy';
import { BrowserIssuanceStore } from '../../issuance/browser-issuance.store';
import { SessionIssuanceService } from '../../services/session-issuance.service';
import { addMs, capIdleByAbsolute } from '../../utils/session/session-deadline';
import { hashToken, randomSecret } from '../../utils/hashing/token-hash';
import { SessionDocument } from '../../persistence/mongo/schemas/session.schema';
import request from 'supertest';
import { OAUTH_ERROR } from '../oauth/native-oauth.types';
import { runForcedIssuanceRace } from '../../../../test/utils/session/session-issuance-race';
import {
  NativeOauthHarness,
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
  approveNativeCode,
  nativeHttpServer,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../persistence/mongo/harness/native-oauth.harness-spec';
import {
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';

describe('native session limit', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_session_limit');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('serializes parallel exchanges at one remaining session slot', async () => {
    const user = await createTestUser(ctx.harness.users, 'limit@example.com');
    await seedBrowserSessions(ctx, user._id, MAX_SESSIONS_PER_USER - 1);
    const firstCode = await approveNativeCode(ctx, user);
    const secondCode = await approveNativeCode(ctx, user);
    const issuance = ctx.harness.app.get(SessionIssuanceService);

    const results = await runForcedIssuanceRace(
      issuance,
      ctx.harness.app.get(BrowserIssuanceStore),
      () => exchange(ctx, firstCode.code, firstCode.verifier),
      () => exchange(ctx, secondCode.code, secondCode.verifier),
    );
    if (
      results[0].status !== 'fulfilled' ||
      results[1].status !== 'fulfilled'
    ) {
      throw new Error('native exchanges did not return OAuth results');
    }
    const grants = [results[0].value, results[1].value];

    expect(grants.filter((result) => result.ok)).toHaveLength(1);
    expect(
      grants.filter((result) => !result.ok).map((result) => result.error),
    ).toEqual([OAUTH_ERROR.ACCESS_DENIED]);
    expect(
      await ctx.harness.sessions.countDocuments({
        user: user._id,
        isValid: true,
      }),
    ).toBe(MAX_SESSIONS_PER_USER);
    expect(await ctx.credentials.countDocuments()).toBe(2);
  });

  it('serializes browser issuance against a native exchange at one remaining slot', async () => {
    const user = await createTestUser(
      ctx.harness.users,
      'mixed-race@example.com',
    );
    await seedBrowserSessions(ctx, user._id, MAX_SESSIONS_PER_USER - 1);
    const approved = await approveNativeCode(ctx, user);
    const issuance = ctx.harness.app.get(SessionIssuanceService);

    const results = await runForcedIssuanceRace(
      issuance,
      ctx.harness.app.get(BrowserIssuanceStore),
      () =>
        issuance.createBrowserSession(
          user._id.toString(),
          'Browser/1',
          '127.0.0.1',
        ),
      () => exchange(ctx, approved.code, approved.verifier),
    );

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('fulfilled');
    if (results[1].status !== 'fulfilled') {
      throw new Error('native exchange did not return an OAuth result');
    }
    expect(results[1].value).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.ACCESS_DENIED,
    });
    expect(
      await ctx.harness.sessions.countDocuments({
        user: user._id,
        isValid: true,
      }),
    ).toBe(MAX_SESSIONS_PER_USER);
    expect(await ctx.credentials.countDocuments()).toBe(0);
  });

  it('leaves a code reusable when full, then exchanges it after revocation', async () => {
    const user = await createTestUser(ctx.harness.users, 'full@example.com');
    await seedBrowserSessions(ctx, user._id, MAX_SESSIONS_PER_USER);
    const approved = await approveNativeCode(ctx, user);

    const denied = await request(nativeHttpServer(ctx.harness.app))
      .post('/api/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code: approved.code,
        redirect_uri: NATIVE_REDIRECT,
        client_id: NATIVE_CLIENT_ID,
        code_verifier: approved.verifier,
      });

    expect(denied.status).toBe(400);
    expect(denied.body).toEqual({ error: OAUTH_ERROR.ACCESS_DENIED });
    expect(denied.headers['cache-control']).toBe('no-store');
    expect(denied.headers.pragma).toBe('no-cache');
    expect(
      await ctx.harness.sessions.countDocuments({
        user: user._id,
        isValid: true,
      }),
    ).toBe(MAX_SESSIONS_PER_USER);
    expect(await ctx.credentials.countDocuments()).toBe(0);
    expect(
      (
        await ctx.transactions.findOne({
          transactionId: approved.transactionId,
        })
      )?.consumed,
    ).toBe(false);
    const revoked = await ctx.harness.sessions.findOne({ user: user._id });
    if (!revoked) {
      throw new Error('expected a session to revoke');
    }
    expect(
      await ctx.harness.revocation.revokeById(revoked._id.toString(), user._id),
    ).toBe(true);

    const granted = await exchange(ctx, approved.code, approved.verifier);

    expect(granted.ok).toBe(true);
    expect(await ctx.credentials.countDocuments()).toBe(2);
    expect(
      (
        await ctx.transactions.findOne({
          transactionId: approved.transactionId,
        })
      )?.consumed,
    ).toBe(true);
  });

  it('counts native sessions when a browser sign-in reaches the cap', async () => {
    const user = await createTestUser(ctx.harness.users, 'mixed@example.com');
    const approved = await approveNativeCode(ctx, user);
    const nativeGrant = await exchange(ctx, approved.code, approved.verifier);
    expect(nativeGrant.ok).toBe(true);
    await seedBrowserSessions(ctx, user._id, MAX_SESSIONS_PER_USER - 1);
    const issuance = ctx.harness.app.get(SessionIssuanceService);

    await expect(
      issuance.createBrowserSession(
        user._id.toString(),
        'Browser/1',
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SESSION_LIMIT_REACHED });
    expect(
      await ctx.harness.sessions.countDocuments({
        user: user._id,
        isValid: true,
      }),
    ).toBe(MAX_SESSIONS_PER_USER);
  });
});

async function exchange(
  ctx: NativeOauthHarness,
  code: string,
  verifier: string,
) {
  return ctx.tokens.grant(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: NATIVE_REDIRECT,
      client_id: NATIVE_CLIENT_ID,
      code_verifier: verifier,
    },
    NATIVE_META,
  );
}

async function seedBrowserSessions(
  ctx: NativeOauthHarness,
  userId: SessionDocument['user'],
  count: number,
): Promise<void> {
  const issuance = ctx.harness.app.get(SessionIssuanceService);
  await issuance.createBrowserSession(
    userId.toString(),
    'Browser/1',
    '127.0.0.1',
  );
  const remaining = count - 1;
  if (remaining <= 0) {
    return;
  }
  const application = await ctx.harness.applications.findOne({
    clientId: WEB_CLIENT_ID,
    environment: ctx.harness.app.get(AuthEpochService).environment(),
  });
  const user = await ctx.harness.users.findById(userId);
  const grant = await ctx.harness.grants.findOne({
    userId,
    clientId: WEB_CLIENT_ID,
  });
  if (!application || !user || !grant) {
    throw new Error('browser session authority is not seeded');
  }
  const now = ctx.harness.clock.now();
  const absoluteExpiresAt = addMs(now, application.policy.absoluteLifetimeMs);
  const idleExpiresAt = capIdleByAbsolute(
    addMs(now, application.policy.idleLifetimeMs),
    absoluteExpiresAt,
  );
  const rows = Array.from({ length: remaining }, () => ({
    user: userId,
    tokenHash: hashToken(randomSecret()),
    userAgent: 'Browser/1',
    ip: '127.0.0.1',
    isValid: true,
    lastUsedAt: now,
    expiresAt: absoluteExpiresAt,
    schemaVersion: AUTH_SCHEMA_VERSION,
    authEpoch: ctx.harness.app.get(AuthEpochService).current(),
    clientId: WEB_CLIENT_ID,
    userVersion: user.sessionVersion ?? 0,
    clientVersion: application.sessionVersion ?? 0,
    grantVersion: grant.sessionVersion ?? 0,
    scopes: [DEFAULT_API_AUDIENCE],
    audience: DEFAULT_API_AUDIENCE,
    authenticationMethods: [],
    authenticatedAt: now,
    idleExpiresAt,
    lastActivityAt: now,
    credentialPurpose: CREDENTIAL_PURPOSE.BROWSER_SESSION,
    csrfToken: randomSecret(),
  }));
  await ctx.harness.sessions.create(rows, { ordered: true });
}

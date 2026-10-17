import { randomBytes } from 'crypto';
import request from 'supertest';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { OAUTH_ERROR } from './native-oauth.types';
import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import {
  NATIVE_ACCESS_LIFETIME_MS,
  NATIVE_INITIAL_IDLE_MS,
} from '../../constants/session-policy';
import {
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
  NativeOauthHarness,
  issueNativeGrant,
  nativeAuthorizeQuery,
  approveNativeCode,
  approvalRedirectUri,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
  nativeHttpServer,
} from '../persistence/mongo/harness/native-oauth.harness-spec';
import {
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/utils/session-authority-harness';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';

describe('native authorization (plan 04)', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_authorization');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('refuses to start when native issuance is disabled', async () => {
    jest
      .spyOn(ctx.harness.app.get(AuthEpochService), 'nativeEnabled')
      .mockReturnValueOnce(false);
    const result = await ctx.authorize.begin(
      nativeAuthorizeQuery('a'.repeat(43)),
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: OAUTH_ERROR.UNAUTHORIZED_CLIENT,
      error_description: ErrorCode.NATIVE_AUTH_DISABLED,
    });
    expect(await ctx.transactions.countDocuments()).toBe(0);
  });

  it('rejects a foreign redirect and an implicit response before storing a transaction', async () => {
    const foreign = await ctx.authorize.begin(
      nativeAuthorizeQuery('a'.repeat(43), {
        redirect_uri: 'myapp://callback.evil',
      }),
    );
    const implicit = await ctx.authorize.begin(
      nativeAuthorizeQuery('a'.repeat(43), { response_type: 'token' }),
    );
    expect(foreign).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(implicit).toMatchObject({
      ok: false,
      error: 'unsupported_response_type',
    });
    expect(await ctx.transactions.countDocuments()).toBe(0);
  });

  it('refuses approval when native authorization is disabled', async () => {
    const user = await createTestUser(ctx.harness.users, 'native@example.com');
    const begun = await ctx.authorize.begin(
      nativeAuthorizeQuery('a'.repeat(43)),
    );
    if (!begun.ok) {
      throw new Error(begun.error);
    }
    jest
      .spyOn(ctx.harness.app.get(AuthEpochService), 'nativeEnabled')
      .mockReturnValueOnce(false);

    await expect(
      ctx.authorize.approve(user._id.toString(), begun.transactionId, [
        'password',
      ]),
    ).rejects.toMatchObject({
      code: ErrorCode.NATIVE_AUTH_DISABLED,
      status: 403,
    });
    expect(
      (await ctx.transactions.findOne({ transactionId: begun.transactionId }))
        ?.codeHash,
    ).toBeUndefined();
  });

  it('redirects to the native authorization page with only the transaction', async () => {
    const verifier = randomBytes(32).toString('base64url');
    const response = await request(nativeHttpServer(ctx.harness.app))
      .get('/api/oauth/authorize')
      .query(nativeAuthorizeQuery(verifier))
      .set('Accept-Language', 'en')
      .redirects(0);
    expect(response.status).toBe(302);
    const location = new URL(String(response.headers.location));
    expect(location.origin).toBe('http://localhost:3000');
    expect(location.pathname).toBe('/en/auth/native/authorize');
    expect([...location.searchParams.keys()]).toEqual(['transaction']);
    expect(String(response.headers.location)).not.toContain('myapp://');
  });

  // feature:locale-ar:start
  // feature:locale-ar:end

  it('exchanges a code once and keeps the access token off the cookie session', async () => {
    const granted = await issueNativeGrant(ctx);
    expect(granted.expiresIn).toBe(NATIVE_ACCESS_LIFETIME_MS / 1000);
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    expect(session?.credentialPurpose).toBe(CREDENTIAL_PURPOSE.NATIVE_ACCESS);
    expect(session?.idleExpiresAt.getTime()).toBe(
      TEST_NOW.getTime() + NATIVE_INITIAL_IDLE_MS,
    );
    expect(await ctx.access.validate(granted.accessToken)).not.toBeNull();
    expect(
      await ctx.harness.sessionService.validateSession(granted.accessToken),
    ).toBeNull();
    expect(await ctx.access.validate(granted.refreshToken)).toBeNull();
  });

  it('burns a code when the verifier is wrong', async () => {
    const user = await createTestUser(ctx.harness.users, 'native@example.com');
    const approved = await approveNativeCode(ctx, user);
    const wrong = await ctx.tokens.grant(
      {
        grant_type: 'authorization_code',
        code: approved.code,
        redirect_uri: NATIVE_REDIRECT,
        client_id: NATIVE_CLIENT_ID,
        code_verifier: 'b'.repeat(43),
      },
      NATIVE_META,
    );
    expect(wrong).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(await ctx.harness.sessions.countDocuments()).toBe(0);
    expect(
      (
        await ctx.transactions.findOne({
          transactionId: approved.transactionId,
        })
      )?.consumed,
    ).toBe(true);
  });

  it('lets only one of two concurrent exchanges create a session', async () => {
    const user = await createTestUser(ctx.harness.users, 'native@example.com');
    const approved = await approveNativeCode(ctx, user);
    const body = {
      grant_type: 'authorization_code' as const,
      code: approved.code,
      redirect_uri: NATIVE_REDIRECT,
      client_id: NATIVE_CLIENT_ID,
      code_verifier: approved.verifier,
    };
    const [first, second] = await Promise.all([
      ctx.tokens.grant(body, NATIVE_META),
      ctx.tokens.grant(body, NATIVE_META),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect(await ctx.harness.sessions.countDocuments({ isValid: true })).toBe(
      1,
    );
  });

  it('rejects a session cookie on the token endpoint without spending the code', async () => {
    const verifier = randomBytes(32).toString('base64url');
    const begun = await ctx.authorize.begin(nativeAuthorizeQuery(verifier));
    if (!begun.ok) {
      throw new Error(begun.error);
    }
    const user = await createTestUser(ctx.harness.users, 'native@example.com');
    const approved = await ctx.authorize.approve(
      user._id.toString(),
      begun.transactionId,
      ['password'],
    );
    const code =
      new URL(approvalRedirectUri(approved)).searchParams.get('code') ?? '';
    const response = await request(nativeHttpServer(ctx.harness.app))
      .post('/api/oauth/token')
      .set('Cookie', 'sid=browser-session')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: NATIVE_REDIRECT,
        client_id: NATIVE_CLIENT_ID,
        code_verifier: verifier,
      });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid_request' });
    expect(
      (await ctx.transactions.findOne({ transactionId: begun.transactionId }))
        ?.consumed,
    ).toBe(false);
    expect(await ctx.credentials.countDocuments()).toBe(0);
  });
});

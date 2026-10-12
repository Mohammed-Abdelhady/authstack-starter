import {
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
  NativeOauthHarness,
  issueNativeGrant,
  approveNativeCode,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../harness/native-oauth.harness-spec';
import { getModelToken } from '@nestjs/mongoose';
import { MongoTopologyClosedError } from 'mongodb';
import { HttpStatus } from '@nestjs/common';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { CREDENTIAL_PURPOSE } from '../../../../constants/credential-purpose';
import { SECURITY_EVENT_ACTION } from '../../../../constants/security-event-action';
import { OAUTH_ERROR } from '../../../oauth/native-oauth.types';
import { AppException } from '../../../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../../persistence/mongo/schemas/security-event.schema';
import {
  NATIVE_ACCESS_LIFETIME_MS,
  NATIVE_INITIAL_IDLE_MS,
} from '../../../../constants/session-policy';
import {
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';
import { TEST_NOW } from '../../../../../../test/utils/frozen-clock';

describe('native token rotation (plan 04)', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_token_rotation');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('rejects a reused refresh token and the successor it already issued', async () => {
    const granted = await issueNativeGrant(ctx);
    const rotated = await ctx.tokens.grant(
      {
        grant_type: 'refresh_token',
        refresh_token: granted.refreshToken,
        client_id: NATIVE_CLIENT_ID,
      },
      NATIVE_META,
    );
    if (!rotated.ok) {
      throw new Error(rotated.error);
    }
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    if (!session) {
      throw new Error('native session was not created');
    }
    expect(session?.idleExpiresAt.getTime()).toBe(
      TEST_NOW.getTime() + NATIVE_INITIAL_IDLE_MS,
    );
    const replay = await ctx.tokens.grant(
      {
        grant_type: 'refresh_token',
        refresh_token: granted.refreshToken,
        client_id: NATIVE_CLIENT_ID,
      },
      NATIVE_META,
    );
    const successor = await ctx.tokens.grant(
      {
        grant_type: 'refresh_token',
        refresh_token: rotated.refreshToken,
        client_id: NATIVE_CLIENT_ID,
      },
      NATIVE_META,
    );
    expect(replay).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(successor).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(
      (await ctx.harness.sessions.findOne({ clientId: NATIVE_CLIENT_ID }))
        ?.isValid,
    ).toBe(false);
    const events = ctx.harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
    expect(
      await events.distinct('action', {
        sessionId: session._id.toString(),
      }),
    ).toContain(SECURITY_EVENT_ACTION.REFRESH_REPLAYED);
  });

  it('maps an unknown refresh commit through the token grant to its own error code', async () => {
    const granted = await issueNativeGrant(ctx);
    const originalStartSession = ctx.harness.connection.startSession.bind(
      ctx.harness.connection,
    );
    const startSession = jest.spyOn(ctx.harness.connection, 'startSession');
    startSession.mockImplementation(async () => {
      const session = await originalStartSession();
      jest
        .spyOn(session, 'commitTransaction')
        .mockRejectedValue(new MongoTopologyClosedError());
      return session;
    });

    try {
      const outcome = await ctx.tokens
        .grant(
          {
            grant_type: 'refresh_token',
            refresh_token: granted.refreshToken,
            client_id: NATIVE_CLIENT_ID,
          },
          NATIVE_META,
        )
        .then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(outcome).toBeInstanceOf(AppException);
      if (!(outcome instanceof AppException))
        throw new Error('Expected an application failure');
      expect(outcome.getCode()).toBe(ErrorCode.TRANSACTION_OUTCOME_UNKNOWN);
      expect(outcome.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    } finally {
      startSession.mockRestore();
    }
  });

  it('stops accepting an access token at the exact five-minute deadline', async () => {
    const granted = await issueNativeGrant(ctx);
    ctx.harness.clock.set(
      new Date(TEST_NOW.getTime() + NATIVE_ACCESS_LIFETIME_MS - 1),
    );
    expect(await ctx.access.validate(granted.accessToken)).not.toBeNull();
    ctx.harness.clock.set(
      new Date(TEST_NOW.getTime() + NATIVE_ACCESS_LIFETIME_MS),
    );
    expect(await ctx.access.validate(granted.accessToken)).toBeNull();
  });

  it('treats an unknown revoke as success and leaves another client untouched', async () => {
    const granted = await issueNativeGrant(ctx);
    expect(await ctx.tokens.revoke({ token: 'missing-token' })).toEqual({
      ok: true,
    });
    expect(
      await ctx.tokens.revoke({
        token: granted.accessToken,
        client_id: 'other-app',
      }),
    ).toEqual({ ok: true });
    expect(await ctx.access.validate(granted.accessToken)).not.toBeNull();
    expect(await ctx.tokens.revoke({ token: granted.accessToken })).toEqual({
      ok: true,
    });
    expect(await ctx.access.validate(granted.accessToken)).toBeNull();
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    if (!session) {
      throw new Error('native session was not created');
    }
    const events = ctx.harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
    const revokeEvent = await events
      .findOne({
        sessionId: session._id.toString(),
        action: SECURITY_EVENT_ACTION.NATIVE_CLIENT_REVOKED,
      })
      .lean()
      .exec();
    expect(revokeEvent?.action).toBe(
      SECURITY_EVENT_ACTION.NATIVE_CLIENT_REVOKED,
    );
    expect(session.revokedReason).toBe(
      SECURITY_EVENT_ACTION.NATIVE_CLIENT_REVOKED,
    );
  });

  it('rejects a password grant without creating a session', async () => {
    const result = await ctx.tokens.grant(
      { grant_type: 'password', client_id: NATIVE_CLIENT_ID },
      NATIVE_META,
    );
    expect(result).toMatchObject({
      ok: false,
      error: 'unsupported_grant_type',
    });
    expect(await ctx.harness.sessions.countDocuments()).toBe(0);
  });

  it('creates no session when the user version changed after approval', async () => {
    const user = await createTestUser(ctx.harness.users, 'native@example.com');
    const approved = await approveNativeCode(ctx, user);
    await ctx.harness.users.updateOne(
      { _id: user._id },
      { $inc: { sessionVersion: 1 } },
    );
    const granted = await ctx.tokens.grant(
      {
        grant_type: 'authorization_code',
        code: approved.code,
        redirect_uri: NATIVE_REDIRECT,
        client_id: NATIVE_CLIENT_ID,
        code_verifier: approved.verifier,
      },
      NATIVE_META,
    );
    expect(granted).toMatchObject({ ok: false, error: 'invalid_grant' });
    expect(await ctx.harness.sessions.countDocuments()).toBe(0);
  });

  it('does not rotate after the auth epoch changes', async () => {
    const granted = await issueNativeGrant(ctx);
    ctx.harness.app.get(ConfigService).set('auth.epoch', 2);

    const result = await ctx.tokens.grant(
      {
        grant_type: 'refresh_token',
        refresh_token: granted.refreshToken,
        client_id: NATIVE_CLIENT_ID,
      },
      NATIVE_META,
    );

    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_GRANT,
    });
    expect(await ctx.credentials.countDocuments()).toBe(2);
    const refresh = await ctx.credentials.findOne({
      purpose: CREDENTIAL_PURPOSE.NATIVE_REFRESH,
    });
    expect(refresh?.spent).toBe(false);
  });

  it('does not rotate when the native application is disabled', async () => {
    const granted = await issueNativeGrant(ctx);
    await ctx.harness.applications.updateOne(
      { clientId: NATIVE_CLIENT_ID },
      { $set: { enabled: false } },
    );

    const result = await ctx.tokens.grant(
      {
        grant_type: 'refresh_token',
        refresh_token: granted.refreshToken,
        client_id: NATIVE_CLIENT_ID,
      },
      NATIVE_META,
    );

    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_GRANT,
    });
    expect(await ctx.credentials.countDocuments()).toBe(2);
    expect(
      await ctx.credentials.findOne({
        purpose: CREDENTIAL_PURPOSE.NATIVE_REFRESH,
      }),
    ).toMatchObject({ spent: false });
  });

  it('does not rotate when the native grant is revoked', async () => {
    const granted = await issueNativeGrant(ctx);
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    if (!session) {
      throw new Error('native session was not created');
    }
    await ctx.harness.grants.updateOne(
      { userId: session.user, clientId: NATIVE_CLIENT_ID },
      { $set: { allowed: false } },
    );

    const result = await ctx.tokens.grant(
      {
        grant_type: 'refresh_token',
        refresh_token: granted.refreshToken,
        client_id: NATIVE_CLIENT_ID,
      },
      NATIVE_META,
    );

    expect(result).toMatchObject({
      ok: false,
      error: OAUTH_ERROR.INVALID_GRANT,
    });
    expect(await ctx.credentials.countDocuments()).toBe(2);
    expect(
      await ctx.credentials.findOne({
        purpose: CREDENTIAL_PURPOSE.NATIVE_REFRESH,
      }),
    ).toMatchObject({ spent: false });
  });
});

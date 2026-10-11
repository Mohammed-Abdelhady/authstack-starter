import {
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NativeOauthHarness,
  issueNativeGrant,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../harness/native-oauth.harness-spec';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CREDENTIAL_PURPOSE } from '../../../../constants/credential-purpose';
import { SECURITY_EVENT_ACTION } from '../../../../constants/security-event-action';
import { OAUTH_ERROR } from '../../../oauth/native-oauth.types';
import { NativeSessionRevocationService } from '../../../../services/native-session-revocation.service';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../../persistence/mongo/schemas/security-event.schema';
import { NATIVE_IDLE_LIFETIME_MS } from '../../../../constants/session-policy';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';
import { TEST_NOW } from '../../../../../../test/utils/frozen-clock';

describe('native token lifetimes (first use and revoked families)', () => {
  let ctx: NativeOauthHarness;

  beforeAll(async () => {
    ctx = await startNativeOauth('native_token_lifetimes');
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
  });

  it('refuses a refresh when a new session stays idle past the first-use window', async () => {
    const granted = await issueNativeGrant(ctx);
    // The five-minute first-use window, pinned as a literal: changing
    // NATIVE_INITIAL_IDLE_MS must break this test, not follow it.
    ctx.harness.clock.set(new Date(TEST_NOW.getTime() + 5 * 60 * 1000 + 1));

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

  it('answers invalid_grant without a replay after sign out ended the family', async () => {
    const granted = await issueNativeGrant(ctx);
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    if (!session) {
      throw new Error('native session was not created');
    }
    const revocation = ctx.harness.app.get(NativeSessionRevocationService);
    expect(
      await revocation.revokeNativeSession(
        session._id.toString(),
        session.user,
      ),
    ).toBe(true);
    const ended = await ctx.harness.sessions.findById(session._id).exec();
    expect(ended?.revokedReason).toBe('current_logout');
    const revokedAt = ended?.revokedAt?.getTime();
    ctx.harness.clock.set(new Date(TEST_NOW.getTime() + 1000));

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
    const after = await ctx.harness.sessions.findById(session._id).exec();
    expect(after?.revokedReason).toBe('current_logout');
    expect(after?.revokedAt?.getTime()).toBe(revokedAt);
    const events = ctx.harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
    expect(
      await events.countDocuments({
        sessionId: session._id.toString(),
        action: SECURITY_EVENT_ACTION.REFRESH_REPLAYED,
      }),
    ).toBe(0);
  });

  it('answers invalid_grant without a replay after revoke ended the family', async () => {
    const granted = await issueNativeGrant(ctx);
    expect(await ctx.tokens.revoke({ token: granted.accessToken })).toEqual({
      ok: true,
    });
    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    expect(session?.revokedReason).toBe('native_client_revoked');
    const revokedAt = session?.revokedAt?.getTime();
    ctx.harness.clock.set(new Date(TEST_NOW.getTime() + 1000));

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
    const after = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    expect(after?.revokedReason).toBe('native_client_revoked');
    expect(after?.revokedAt?.getTime()).toBe(revokedAt);
    const events = ctx.harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
    expect(
      await events.countDocuments({
        sessionId: session?._id.toString(),
        action: SECURITY_EVENT_ACTION.REFRESH_REPLAYED,
      }),
    ).toBe(0);
  });

  it('gives the normal idle lifetime after an authenticated call inside the window', async () => {
    const granted = await issueNativeGrant(ctx);
    // Four minutes in: inside the five-minute window pinned above.
    const activityAt = TEST_NOW.getTime() + 5 * 60 * 1000 - 60 * 1000;
    ctx.harness.clock.set(new Date(activityAt));
    expect(await ctx.access.validate(granted.accessToken)).not.toBeNull();

    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    expect(session?.idleExpiresAt.getTime()).toBe(
      activityAt + NATIVE_IDLE_LIFETIME_MS,
    );

    ctx.harness.clock.set(
      new Date(TEST_NOW.getTime() + NATIVE_IDLE_LIFETIME_MS),
    );
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
    expect(typeof rotated.accessToken).toBe('string');
  });
});

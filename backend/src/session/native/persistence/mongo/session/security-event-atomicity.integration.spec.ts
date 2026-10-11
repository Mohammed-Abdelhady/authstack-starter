import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../../persistence/mongo/schemas/security-event.schema';
import { hashToken } from '../../../../utils/hashing/token-hash';
import { TokenSuccess, OauthFailure } from '../../../oauth/native-oauth.types';
import {
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
  NativeOauthHarness,
  approveNativeCode,
  issueNativeGrant,
  resetNativeClient,
  startNativeOauth,
  stopNativeOauth,
} from '../harness/native-oauth.harness-spec';
import {
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';
import { TEST_NOW } from '../../../../../../test/utils/frozen-clock';
import {
  REFUSED_EVENT_SEED_ACTION,
  refuseSecurityEvents,
} from '../../../../../../test/utils/transaction-failure';

describe('security event insert failure atomicity', () => {
  let ctx: NativeOauthHarness;
  let events: Model<SecurityEventDocument>;

  beforeAll(async () => {
    ctx = await startNativeOauth('security_event_atomicity');
    events = ctx.harness.app.get<Model<SecurityEventDocument>>(
      getModelToken(SecurityEvent.name),
    );
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (ctx) {
      await stopNativeOauth(ctx);
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetNativeClient(ctx);
    await events.deleteMany({});
  });

  it('rolls back a native code exchange when its security event cannot be stored', async () => {
    const user = await createTestUser(
      ctx.harness.users,
      'event-issuance@example.test',
    );
    const approved = await approveNativeCode(ctx, user);
    const allowEvents = await refuseSecurityEvents(events, TEST_NOW);

    try {
      await expect(
        ctx.tokens.grant(
          {
            grant_type: 'authorization_code',
            code: approved.code,
            redirect_uri: NATIVE_REDIRECT,
            client_id: NATIVE_CLIENT_ID,
            code_verifier: approved.verifier,
          },
          NATIVE_META,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.AUTHORITY_UNAVAILABLE });
    } finally {
      allowEvents();
    }

    expect({
      sessions: await ctx.harness.sessions.countDocuments(),
      credentials: await ctx.credentials.countDocuments(),
      events: await events.countDocuments({
        action: { $ne: REFUSED_EVENT_SEED_ACTION },
      }),
      consumed: (
        await ctx.transactions.findOne({
          transactionId: approved.transactionId,
        })
      )?.consumed,
    }).toEqual({ sessions: 0, credentials: 0, events: 0, consumed: false });
  });

  it('rolls back the replay family revocation when its security event cannot be stored', async () => {
    const granted = await issueNativeGrant(ctx);
    const successor = await rotate(ctx, granted.refreshToken);
    if (!successor.ok) {
      throw new Error('setup rotation failed');
    }
    const allowEvents = await refuseSecurityEvents(events, TEST_NOW);

    try {
      await expect(rotate(ctx, granted.refreshToken)).rejects.toMatchObject({
        code: ErrorCode.AUTHORITY_UNAVAILABLE,
      });
    } finally {
      allowEvents();
    }

    const session = await ctx.harness.sessions.findOne({
      clientId: NATIVE_CLIENT_ID,
    });
    if (!session) {
      throw new Error('expected a native session');
    }
    expect({
      sessionValid: session.isValid,
      revoked: session.revokedAt instanceof Date,
      successorSpent: (
        await ctx.credentials.findOne({
          tokenHash: hashToken(successor.refreshToken),
        })
      )?.spent,
    }).toEqual({
      sessionValid: true,
      revoked: false,
      successorSpent: false,
    });

    const usable = await rotate(ctx, successor.refreshToken);
    expect(usable.ok).toBe(true);
  });
});

function rotate(
  ctx: NativeOauthHarness,
  refreshToken: string,
): Promise<TokenSuccess | OauthFailure> {
  return ctx.tokens.grant(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: NATIVE_CLIENT_ID,
    },
    NATIVE_META,
  );
}

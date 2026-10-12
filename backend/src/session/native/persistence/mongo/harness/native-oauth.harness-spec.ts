import { randomBytes } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Server } from 'node:http';
import { Model } from 'mongoose';
import { UserDocument } from '../../../../../user/persistence/mongo/schemas/user.schema';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
} from '../../../../constants/client-ids';
import {
  NATIVE_ABSOLUTE_LIFETIME_MS,
  NATIVE_IDLE_LIFETIME_MS,
} from '../../../../constants/session-policy';
import { NativeAccessService } from '../../../access/native-access.service';
import { NativeAuthorizeService } from '../../../authorize/native-authorize.service';
import { TokenSuccess } from '../../../oauth/native-oauth.types';
import { NativeTokenService } from '../../../token/native-token.service';
import {
  approvalRedirectUri,
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
  nativeAuthorizeQuery,
} from '../../../harness/native-oauth-requests.harness-spec';
import {
  NATIVE_DPOP_TEST_SECRET,
  NATIVE_PUBLIC_API_ORIGIN,
  signNativeDpopProof,
} from '../../../harness/native-dpop-test-vectors.harness-spec';
import {
  AuthorizationTransaction,
  AuthorizationTransactionDocument,
} from '../../../../persistence/mongo/schemas/authorization-transaction.schema';
import {
  NativeCredential,
  NativeCredentialDocument,
} from '../../../../persistence/mongo/schemas/native-credential.schema';
import {
  NativeDpopProofId,
  NativeDpopProofIdDocument,
} from '../../../../persistence/mongo/schemas/native-dpop-proof-id.schema';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../../persistence/mongo/schemas/security-event.schema';
import { startMemoryReplSet } from '../../../../../../test/utils/memory-replset';
import {
  FrozenClock,
  TEST_NOW,
} from '../../../../../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  createTestUser,
  SessionAuthorityHarness,
} from '../../../../../../test/utils/session-authority-harness';

export {
  approvalRedirectUri,
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
  nativeAuthorizeQuery,
};
export { NATIVE_DPOP_TEST_SECRET, NATIVE_PUBLIC_API_ORIGIN };

export interface NativeOauthHarness {
  mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  harness: SessionAuthorityHarness;
  authorize: NativeAuthorizeService;
  tokens: NativeTokenService;
  access: NativeAccessService;
  transactions: Model<AuthorizationTransactionDocument>;
  credentials: Model<NativeCredentialDocument>;
  proofIds: Model<NativeDpopProofIdDocument>;
  securityEvents: Model<SecurityEventDocument>;
}

export interface ApprovedNativeCode {
  code: string;
  verifier: string;
  transactionId: string;
}

export function nativeHttpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

export async function startNativeOauth(
  dbName: string,
  options: { nativeDpopRequired?: boolean } = {},
): Promise<NativeOauthHarness> {
  const mongo = await startMemoryReplSet();
  const previousSecret = process.env.AUTH_NATIVE_DPOP_NONCE_SECRET;
  const previousApiUrl = process.env.API_URL;
  const previousDpopRequired = process.env.AUTH_NATIVE_DPOP_REQUIRED;
  process.env.AUTH_NATIVE_DPOP_NONCE_SECRET = NATIVE_DPOP_TEST_SECRET;
  process.env.API_URL = NATIVE_PUBLIC_API_ORIGIN;
  process.env.AUTH_NATIVE_DPOP_REQUIRED = String(
    options.nativeDpopRequired ?? false,
  );
  try {
    const harness = await bootSessionAuthority(
      mongo.uri(dbName),
      new FrozenClock(TEST_NOW),
      { nativeEnabled: true, withNativeHttp: true },
    );
    return {
      mongo,
      harness,
      authorize: harness.app.get(NativeAuthorizeService),
      tokens: harness.app.get(NativeTokenService),
      access: harness.app.get(NativeAccessService),
      transactions: harness.app.get(
        getModelToken(AuthorizationTransaction.name),
      ),
      credentials: harness.app.get(getModelToken(NativeCredential.name)),
      proofIds: harness.app.get(getModelToken(NativeDpopProofId.name)),
      securityEvents: harness.app.get(getModelToken(SecurityEvent.name)),
    };
  } finally {
    restoreEnvironmentValue('AUTH_NATIVE_DPOP_NONCE_SECRET', previousSecret);
    restoreEnvironmentValue('API_URL', previousApiUrl);
    restoreEnvironmentValue('AUTH_NATIVE_DPOP_REQUIRED', previousDpopRequired);
  }
}

export async function stopNativeOauth(ctx: NativeOauthHarness): Promise<void> {
  await ctx.harness.app.close();
  await ctx.mongo.stop();
}

export async function resetNativeClient(
  ctx: NativeOauthHarness,
): Promise<void> {
  ctx.harness.clock.set(TEST_NOW);
  await ctx.harness.sessions.deleteMany({});
  await ctx.harness.grants.deleteMany({});
  await ctx.harness.users.deleteMany({});
  await ctx.transactions.deleteMany({});
  await ctx.credentials.deleteMany({});
  await ctx.proofIds.deleteMany({});
  await ctx.securityEvents.deleteMany({});
  await ctx.harness.applications.deleteMany({ clientId: NATIVE_CLIENT_ID });
  await ctx.harness.applications.create({
    clientId: NATIVE_CLIENT_ID,
    displayName: 'Native',
    platform: APPLICATION_PLATFORM.NATIVE,
    environment: 'test',
    clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
    enabled: true,
    redirectUris: [NATIVE_REDIRECT],
    allowedOrigins: [],
    audiences: [DEFAULT_API_AUDIENCE],
    allowedScopes: [DEFAULT_API_AUDIENCE],
    policy: {
      absoluteLifetimeMs: NATIVE_ABSOLUTE_LIFETIME_MS,
      idleLifetimeMs: NATIVE_IDLE_LIFETIME_MS,
    },
    sessionVersion: 0,
    issuanceFence: 0,
  });
}

function restoreEnvironmentValue(
  key:
    'AUTH_NATIVE_DPOP_NONCE_SECRET' | 'API_URL' | 'AUTH_NATIVE_DPOP_REQUIRED',
  previous: string | undefined,
): void {
  if (previous === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = previous;
}

export async function issueNativeGrant(
  ctx: NativeOauthHarness,
): Promise<TokenSuccess> {
  const user = await createTestUser(ctx.harness.users, 'native@example.com');
  const approved = await approveNativeCode(ctx, user);
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
  if (!granted.ok) {
    throw new Error(granted.error);
  }
  return granted;
}

export async function issueBoundNativeGrant(
  ctx: NativeOauthHarness,
  proofId = 'native-initial-exchange-proof',
): Promise<TokenSuccess> {
  const user = await createTestUser(
    ctx.harness.users,
    'bound-native@example.com',
  );
  const approved = await approveNativeCode(ctx, user);
  const granted = await ctx.tokens.grant(
    {
      grant_type: 'authorization_code',
      code: approved.code,
      redirect_uri: NATIVE_REDIRECT,
      client_id: NATIVE_CLIENT_ID,
      code_verifier: approved.verifier,
    },
    NATIVE_META,
    signNativeDpopProof({ claims: { jti: proofId } }),
  );
  if (!granted.ok) {
    throw new Error(granted.error);
  }
  return granted;
}

export async function approveNativeCode(
  ctx: NativeOauthHarness,
  user: UserDocument,
): Promise<ApprovedNativeCode> {
  const verifier = randomBytes(32).toString('base64url');
  const begun = await ctx.authorize.begin(nativeAuthorizeQuery(verifier));
  if (!begun.ok) {
    throw new Error(begun.error);
  }
  const approved = await ctx.authorize.approve(
    user._id.toString(),
    begun.transactionId,
    ['password'],
  );
  const code = new URL(approvalRedirectUri(approved)).searchParams.get('code');
  if (!code) {
    throw new Error('missing code');
  }
  return { code, verifier, transactionId: begun.transactionId };
}

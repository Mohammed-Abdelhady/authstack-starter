import { randomBytes } from 'crypto';
import request from 'supertest';
import { AuthEpochService } from '../../../src/common/services/auth-epoch.service';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
} from '../../../src/session/constants/client-ids';
import {
  NATIVE_ABSOLUTE_LIFETIME_MS,
  NATIVE_IDLE_LIFETIME_MS,
} from '../../../src/session/constants/session-policy';
import {
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
  nativeAuthorizeQuery,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_USER } from '../../constants/seed-users';
import type { E2eApp } from '../e2e-app';
import type { AuthorizationReadGate } from '../e2e-state-native';
import { NativeAuthorizeService } from '../../../src/session/native/authorize/native-authorize.service';
import { NativeTokenService } from '../../../src/session/native/token/native-token.service';
import { NATIVE_META } from '../../../src/session/native/harness/native-oauth-requests.harness-spec';

export { NATIVE_CLIENT_ID, NATIVE_REDIRECT };

export async function issueNativeGrantFor(
  e2e: E2eApp,
  email: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const user = await e2e.state.accounts.accountWithAddress(email);
  if (!user) throw new Error('seed user is missing');
  const verifier = randomBytes(32).toString('base64url');
  const authorize = e2e.app.get(NativeAuthorizeService);
  const begun = await authorize.begin(nativeAuthorizeQuery(verifier));
  if (!begun.ok) throw new Error(begun.error);
  const approved = await authorize.approve(
    user._id.toString(),
    begun.transactionId,
    ['password'],
  );
  const code = new URL(approved.redirectUri).searchParams.get('code');
  if (!code) throw new Error('authorization code is missing');
  const result = await e2e.app.get(NativeTokenService).grant(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: NATIVE_REDIRECT,
      client_id: NATIVE_CLIENT_ID,
      code_verifier: verifier,
    },
    NATIVE_META,
  );
  if (!result.ok) throw new Error(result.error);
  return { accessToken: result.accessToken, refreshToken: result.refreshToken };
}

export interface StartedNativeAuthorization {
  transactionId: string;
  verifier: string;
  location: string;
}

/** The seed user's id, which a consent action names as the account it was shown to. */
export async function seedUserId(e2e: E2eApp): Promise<string> {
  const id = await e2e.state.accounts.accountIdFor(SEED_USER.email);
  if (id === null) {
    throw new Error('the seed user is missing');
  }
  return id;
}

export async function createNativeApplication(e2e: E2eApp): Promise<void> {
  await e2e.state.applications.createApplication({
    clientId: NATIVE_CLIENT_ID,
    displayName: 'Native test client',
    platform: APPLICATION_PLATFORM.NATIVE,
    environment: e2e.app.get(AuthEpochService).environment(),
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
  });
}

export async function beginNativeAuthorization(
  e2e: E2eApp,
  acceptLanguage?: string,
): Promise<StartedNativeAuthorization> {
  const verifier = randomBytes(32).toString('base64url');
  let call = request(e2e.httpServer)
    .get('/api/oauth/authorize')
    .query(nativeAuthorizeQuery(verifier));
  if (acceptLanguage) {
    call = call.set('Accept-Language', acceptLanguage);
  }
  const response = await call.redirects(0);
  const location = response.headers.location;
  if (response.status !== 302 || typeof location !== 'string') {
    throw new Error('Native authorization did not redirect to the browser');
  }
  const transactionId = new URL(location).searchParams.get('transaction');
  if (!transactionId) {
    throw new Error('Native authorization redirect has no transaction id');
  }
  return { transactionId, verifier, location };
}

export function pauseNextNativeAuthorizationRead(
  e2e: E2eApp,
): AuthorizationReadGate {
  return e2e.state.native.pauseNextAuthorizationRead();
}

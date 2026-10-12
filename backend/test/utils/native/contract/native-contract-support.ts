import { createHash } from 'node:crypto';
import { AppException } from '../../../../src/common/exceptions/app.exception';
import {
  DPOP_TEST_PUBLIC_KEY_B,
  signNativeDpopProof,
} from '../../../../src/session/native/harness/native-dpop-test-vectors.harness-spec';
import {
  OauthFailure,
  TokenSuccess,
} from '../../../../src/session/native/oauth/native-oauth.types';
import {
  NativeApplicationSeed,
  NativeContractHarness,
  NativeServices,
  StoredCredential,
} from './native-contract-harness';

export type NativeHarnessSource = () => NativeContractHarness;

export const NATIVE_CLIENT = 'native-app';
export const NATIVE_DISPLAY_NAME = 'Native Contract';
export const NATIVE_REDIRECT = 'myapp://callback';
export const NATIVE_META = { ip: '203.0.113.10', userAgent: 'NativeTest/1' };
export const ABORTED = 'the work was aborted on purpose';

const THIRTY_DAYS_MS = 2_592_000_000;
const SEVEN_DAYS_MS = 604_800_000;

export const NATIVE_APPLICATION: NativeApplicationSeed & {
  absoluteLifetimeMs: number;
  idleLifetimeMs: number;
} = {
  enabled: true,
  platform: 'native',
  clientType: 'public',
  redirectUris: [NATIVE_REDIRECT],
  sessionVersion: 0,
  absoluteLifetimeMs: THIRTY_DAYS_MS,
  idleLifetimeMs: SEVEN_DAYS_MS,
};

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** A PKCE verifier that is the same on every run, one per number. */
export function verifierFor(index: number): string {
  return `contract-verifier-${String(index).padStart(4, '0')}-`.padEnd(48, 'x');
}

export interface BegunAuthorization {
  transactionId: string;
  verifier: string;
}

export interface ApprovedCode extends BegunAuthorization {
  code: string;
}

let verifiers = 0;

export async function begin(
  services: NativeServices,
  state = 'state-1',
): Promise<BegunAuthorization> {
  verifiers += 1;
  const verifier = verifierFor(verifiers);
  const begun = await services.authorize.begin({
    response_type: 'code',
    client_id: NATIVE_CLIENT,
    redirect_uri: NATIVE_REDIRECT,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
    scope: 'api',
  });
  if (!begun.ok) {
    throw new Error(`begin was refused: ${begun.error}`);
  }
  return { transactionId: begun.transactionId, verifier };
}

export function codeOf(redirectUri: string): string {
  const code = new URL(redirectUri).searchParams.get('code');
  if (!code) {
    throw new Error('the approval carried no code');
  }
  return code;
}

export async function approvedCode(
  services: NativeServices,
  userId: string,
): Promise<ApprovedCode> {
  const begun = await begin(services);
  const approved = await services.authorize.approve(
    userId,
    begun.transactionId,
    ['password'],
  );
  return { ...begun, code: codeOf(approved.redirectUri) };
}

export function exchange(
  services: NativeServices,
  approved: { code: string; verifier: string },
  proof?: string,
): Promise<TokenSuccess | OauthFailure> {
  return services.tokens.grant(
    {
      grant_type: 'authorization_code',
      code: approved.code,
      redirect_uri: NATIVE_REDIRECT,
      client_id: NATIVE_CLIENT,
      code_verifier: approved.verifier,
    },
    NATIVE_META,
    proof,
  );
}

export function refresh(
  services: NativeServices,
  refreshToken: string,
  proof?: string,
): Promise<TokenSuccess | OauthFailure> {
  return services.tokens.grant(
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: NATIVE_CLIENT,
    },
    NATIVE_META,
    proof,
  );
}

/** A proof signed with test key A, or B, for the token and a proof id. */
export function proofFor(
  jti: string,
  token?: string,
  signingKey: 'A' | 'B' = 'A',
): string {
  return signNativeDpopProof({
    claims: { jti },
    ...(token ? { token } : {}),
    ...(signingKey === 'B'
      ? { signingKey, publicJwk: DPOP_TEST_PUBLIC_KEY_B }
      : {}),
  });
}

export function granted(result: TokenSuccess | OauthFailure): TokenSuccess {
  if (!result.ok) {
    throw new Error(`a grant was refused: ${result.error}`);
  }
  return result;
}

export interface SignedInNative {
  userId: string;
  sessionId: string;
  tokens: TokenSuccess;
}

/** An account signed in on the mobile application, with its first pair. */
export async function signInNative(
  harness: NativeContractHarness,
  options: { boundBy?: string; userId?: string } = {},
): Promise<SignedInNative> {
  const services = harness.services();
  const userId = options.userId ?? (await harness.issuance.seedAccount());
  const approved = await approvedCode(services, userId);
  const tokens = granted(
    await exchange(
      services,
      approved,
      options.boundBy ? proofFor(options.boundBy) : undefined,
    ),
  );
  const session = (await harness.issuance.sessions(userId)).find(
    ({ clientId }) => clientId === NATIVE_CLIENT,
  );
  if (!session) {
    throw new Error('the exchange stored no session');
  }
  return { userId, sessionId: session.id, tokens };
}

export interface FamilyState {
  sessionLive: boolean;
  revokedReason: string | null;
  tokens: number;
  unspent: number;
  unrevoked: number;
}

/** A family as counts a case can compare in one go. */
export async function familyState(
  harness: NativeContractHarness,
  sessionId: string,
): Promise<FamilyState> {
  const session = await harness.session(sessionId);
  const tokens = await harness.credentialsOf(sessionId);
  return {
    sessionLive: Boolean(session?.isValid) && session?.revokedAt === null,
    revokedReason: session?.revokedReason ?? null,
    tokens: tokens.length,
    unspent: tokens.filter(({ spent }) => !spent).length,
    unrevoked: tokens.filter(({ revokedAt }) => revokedAt === null).length,
  };
}

export async function storedToken(
  harness: NativeContractHarness,
  sessionId: string,
  token: string,
): Promise<StoredCredential> {
  const tokenHash = sha256Hex(token);
  const stored = (await harness.credentialsOf(sessionId)).find(
    (row) => row.tokenHash === tokenHash,
  );
  if (!stored) {
    throw new Error('the token is not stored');
  }
  return stored;
}

export async function actions(
  harness: NativeContractHarness,
): Promise<string[]> {
  return (await harness.events()).map(({ action }) => action);
}

/** The error code a refused call answered with, or how it ended otherwise. */
export async function outcomeOf(call: Promise<unknown>): Promise<unknown> {
  try {
    return await call;
  } catch (error) {
    return error instanceof AppException ? error.getCode() : error;
  }
}

/** The OAuth error of a failure, or `ok` for a grant. */
export function answerOf(result: TokenSuccess | OauthFailure): string {
  return result.ok
    ? 'ok'
    : [result.error, result.error_description].filter(Boolean).join(' ');
}

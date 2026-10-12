import {
  ApiError,
  type HttpMethod,
  type TokenSet,
  type Transport,
  createApiClient,
} from '@app/sdk';
import request from 'supertest';
import { SEED_USER } from '../../constants/seed-users';
import { loginAs, type E2eApp, type TestAgent } from '../e2e-app';
import {
  beginNativeAuthorization,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
  seedUserId,
} from '../native/native-authorize.fixtures';

type Verb = 'get' | 'post' | 'patch' | 'delete';

const VERBS: Record<HttpMethod, Verb> = {
  GET: 'get',
  POST: 'post',
  PATCH: 'patch',
  DELETE: 'delete',
};

const JSON_TYPE = 'application/json';

interface AuthorizeActionBody {
  data: { redirectUri: string };
}

/** The SDK port over supertest: every status resolves, as the port requires. */
export function supertestTransport(
  caller: () => Pick<TestAgent, Verb>,
  bearer?: string,
): Transport {
  return {
    request: async ({ method, path, body, headers }) => {
      let call = caller()[VERBS[method]](path);
      for (const [name, value] of Object.entries(headers ?? {})) {
        if (name.toLowerCase() !== 'content-type') call = call.set(name, value);
      }
      if (bearer) call = call.set('Authorization', `Bearer ${bearer}`);
      if (typeof body === 'object' && body !== null) call = call.send(body);
      const response = await call;
      return {
        status: response.status,
        body:
          response.type === JSON_TYPE ? (response.body as unknown) : undefined,
      };
    },
  };
}

export function cookieClient(browser: TestAgent) {
  return createApiClient(supertestTransport(() => browser));
}

export function publicClient(e2e: E2eApp) {
  return createApiClient(supertestTransport(() => request(e2e.httpServer)));
}

export function bearerClient(e2e: E2eApp, accessToken: string) {
  return createApiClient(
    supertestTransport(() => request(e2e.httpServer), accessToken),
  );
}

export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} is missing`);
  }
  return value;
}

export async function rejectionOf(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

export async function apiErrorOf(pending: Promise<unknown>): Promise<ApiError> {
  const error = await rejectionOf(pending);
  if (error instanceof ApiError) return error;
  throw error;
}

export interface NativeSignIn {
  browser: TestAgent;
  tokens: TokenSet;
}

/** The whole native journey: browser sign-in, approval, then the code exchange through the client. */
export async function signInNative(e2e: E2eApp): Promise<NativeSignIn> {
  const browser = await loginAs(e2e.httpServer, SEED_USER);
  const started = await beginNativeAuthorization(e2e);
  const approval = await browser
    .post('/api/oauth/authorize/approve')
    .send({
      transactionId: started.transactionId,
      expectedUserId: await seedUserId(e2e),
    })
    .expect(200);
  const callback = new URL(
    (approval.body as AuthorizeActionBody).data.redirectUri,
  );
  const tokens = await publicClient(e2e).oauth.exchangeCode({
    code: required(callback.searchParams.get('code'), 'authorization code'),
    codeVerifier: started.verifier,
    redirectUri: NATIVE_REDIRECT,
    clientId: NATIVE_CLIENT_ID,
  });
  return { browser, tokens };
}

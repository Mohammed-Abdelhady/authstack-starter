import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { SEED_USER } from '../../constants/seed-users';
import {
  beginNativeAuthorization,
  createNativeApplication,
  NATIVE_CLIENT_ID,
  seedUserId,
} from '../../utils/native/native-authorize.fixtures';
import { bootE2eApp, loginAs, type E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import { TEST_NOW } from '../../utils/frozen-clock';
import { nativeAuthorizeQuery } from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import type { AuthorizeQuery } from '../../../src/session/native/oauth/native-oauth.types';

interface ApiErrorBody {
  error: { code: string };
}

const AUTHORIZE_PARAMETERS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
] as const;

describe('native authorization input and stored data guardrails (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    e2e.app.get(ConfigService).set('auth.nativeEnabled', true);
    await createNativeApplication(e2e);
  });

  it('answers invalid_request for missing, empty, repeated, and array query values', async () => {
    const baseline = nativeAuthorizeQuery('a'.repeat(43));

    for (const parameter of AUTHORIZE_PARAMETERS) {
      const missing = authorizeParameters(baseline);
      missing.delete(parameter);
      await expectInvalidAuthorizeQuery(e2e, missing.toString());

      const empty = authorizeParameters(baseline);
      empty.set(parameter, '');
      await expectInvalidAuthorizeQuery(e2e, empty.toString());

      const repeated = authorizeParameters(baseline);
      repeated.append(parameter, String(baseline[parameter]));
      await expectInvalidAuthorizeQuery(e2e, repeated.toString());

      const arrayQuery: Record<string, string | string[]> = {
        ...baseline,
        [parameter]: [String(baseline[parameter]), 'second'],
      };
      const arrayResponse = await request(e2e.httpServer)
        .get('/api/oauth/authorize')
        .query(arrayQuery);
      expect(arrayResponse.status).toBe(400);
      expect(arrayResponse.body).toEqual({ error: 'invalid_request' });
      expect(await e2e.state.native.authorizationRequestCount()).toBe(0);
    }
  });

  it('accepts an omitted scope and stores the application allowed scopes', async () => {
    const query = nativeAuthorizeQuery('a'.repeat(43));
    delete query.scope;
    const response = await request(e2e.httpServer)
      .get('/api/oauth/authorize')
      .query(query)
      .redirects(0);
    const location = response.headers.location;
    expect(response.status).toBe(302);
    expect(typeof location).toBe('string');
    if (typeof location !== 'string') {
      throw new Error('Native authorization did not redirect');
    }
    const transactionId = new URL(location).searchParams.get('transaction');
    expect(transactionId).not.toBeNull();
    if (!transactionId) {
      throw new Error('Native authorization redirect has no transaction id');
    }
    const transaction =
      await e2e.state.native.authorizationRequest(transactionId);

    expect(transaction?.requestedScopes).toEqual(['api']);
  });

  it.each(['empty', 'repeated', 'array'] as const)(
    'answers invalid_request when scope is %s',
    async (shape) => {
      const baseline = nativeAuthorizeQuery('a'.repeat(43));
      if (shape === 'array') {
        const arrayQuery: Record<string, string | string[]> = {
          ...baseline,
          scope: ['api', 'other'],
        };
        const response = await request(e2e.httpServer)
          .get('/api/oauth/authorize')
          .query(arrayQuery);
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'invalid_request' });
        expect(await e2e.state.native.authorizationRequestCount()).toBe(0);
        return;
      }

      const query = authorizeParameters(baseline);
      if (shape === 'empty') {
        query.set('scope', '');
      } else {
        query.append('scope', 'other');
      }
      await expectInvalidAuthorizeQuery(e2e, query.toString());
    },
  );

  it('rejects an unsafe redirect at authorize start without storing a transaction', async () => {
    await e2e.state.applications.storeApplicationRedirects(NATIVE_CLIENT_ID, [
      'javascript:alert(1)',
    ]);
    const response = await request(e2e.httpServer)
      .get('/api/oauth/authorize')
      .query(
        nativeAuthorizeQuery('a'.repeat(43), {
          redirect_uri: 'javascript:alert(1)',
        }),
      );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid_request' });
    expect(await e2e.state.native.authorizationRequestCount()).toBe(0);
  });

  it.each(['approve', 'deny'] as const)(
    '%s refuses an unsafe stored callback before ending the transaction',
    async (action) => {
      const browser = await loginAs(e2e.httpServer, SEED_USER);
      const started = await beginNativeAuthorization(e2e);
      const unsafeRedirect = 'JaVaScRiPt:alert(1)';
      await e2e.state.applications.storeApplicationRedirects(NATIVE_CLIENT_ID, [
        unsafeRedirect,
      ]);
      await e2e.state.native.storeAuthorizationRedirect(
        started.transactionId,
        unsafeRedirect,
      );

      const response = await browser
        .post(`/api/oauth/authorize/${action}`)
        .send({
          transactionId: started.transactionId,
          expectedUserId: await seedUserId(e2e),
        });

      expect(response.status).toBe(404);
      expect((response.body as ApiErrorBody).error.code).toBe(
        ErrorCode.NATIVE_TRANSACTION_EXPIRED,
      );
      const transaction = await e2e.state.native.authorizationRequest(
        started.transactionId,
      );
      expect(transaction?.consumed).toBe(false);
      expect(transaction?.codeHash).toBeUndefined();
    },
  );

  it.each([
    {
      label: 'disabled application',
      patch: { enabled: false },
    },
    {
      label: 'removed callback registration',
      patch: { redirectUris: [] as string[] },
    },
  ])('deny rechecks a $label', async ({ patch }) => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const started = await beginNativeAuthorization(e2e);
    await e2e.state.applications.changeApplication(NATIVE_CLIENT_ID, patch);

    const response = await browser.post('/api/oauth/authorize/deny').send({
      transactionId: started.transactionId,
      expectedUserId: await seedUserId(e2e),
    });

    expect(response.status).toBe(404);
    expect((response.body as ApiErrorBody).error.code).toBe(
      ErrorCode.NATIVE_TRANSACTION_EXPIRED,
    );
    const transaction = await e2e.state.native.authorizationRequest(
      started.transactionId,
    );
    expect(transaction?.consumed).toBe(false);
  });
});

function authorizeParameters(query: AuthorizeQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') {
      params.set(key, value);
    }
  }
  return params;
}

async function expectInvalidAuthorizeQuery(
  e2e: E2eApp,
  query: string,
): Promise<void> {
  const response = await request(e2e.httpServer).get(
    `/api/oauth/authorize?${query}`,
  );
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: 'invalid_request' });
  expect(await e2e.state.native.authorizationRequestCount()).toBe(0);
}

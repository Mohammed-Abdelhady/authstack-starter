import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { CSRF_HEADER } from '../../../src/session/constants/browser-proof';
import { PENDING_AUTH_LIFETIME_MS } from '../../../src/session/constants/session-policy';
import { SEED_USER } from '../../constants/seed-users';
import {
  beginNativeAuthorization,
  createNativeApplication,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
  seedUserId,
} from '../../utils/native/native-authorize.fixtures';
import { bootE2eApp, loginAs, type E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import { TEST_NOW } from '../../utils/frozen-clock';

interface ApiErrorBody {
  error: { code: string };
}

interface AuthorizeActionBody {
  success: boolean;
  data: { redirectUri: string };
}

interface TokenResponseBody {
  access_token: string;
}

describe('native browser authorization (e2e)', () => {
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

  it('returns only the browser fields for a signed-out transaction', async () => {
    const started = await beginNativeAuthorization(e2e);
    const location = new URL(started.location);
    expect(location.pathname).toBe('/en/auth/native/authorize');
    expect([...location.searchParams.keys()]).toEqual(['transaction']);

    const signedOut = await request(e2e.httpServer).get(
      `/api/oauth/authorize/transaction/${started.transactionId}`,
    );
    expect(signedOut.status).toBe(401);
    expect((signedOut.body as ApiErrorBody).error.code).toBe(
      ErrorCode.SESSION_REQUIRED,
    );

    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const read = await browser
      .get(`/api/oauth/authorize/transaction/${started.transactionId}`)
      .expect(200);
    expect(read.body).toEqual({
      success: true,
      data: {
        applicationName: 'Native test client',
        platform: 'native',
        expiresAt: '2099-01-01T12:05:00.000Z',
        alreadyGranted: false,
      },
    });
  });

  // feature:locale-ar:start
  // feature:locale-ar:end

  it('requires a browser proof header for approval and denial', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const started = await beginNativeAuthorization(e2e);

    // The agent presents its proof by itself, so these two take it off.
    const approval = await browser
      .post('/api/oauth/authorize/approve')
      .unset(CSRF_HEADER)
      .send({
        transactionId: started.transactionId,
        expectedUserId: await seedUserId(e2e),
      });
    const denial = await browser
      .post('/api/oauth/authorize/deny')
      .unset(CSRF_HEADER)
      .send({
        transactionId: started.transactionId,
        expectedUserId: await seedUserId(e2e),
      });
    for (const response of [approval, denial]) {
      expect(response.status).toBe(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        ErrorCode.CSRF_REQUIRED,
      );
    }
  });

  it('approves once, exchanges the code, and uses the token on a protected route', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const started = await beginNativeAuthorization(e2e);
    const approval = await browser
      .post('/api/oauth/authorize/approve')
      .send({
        transactionId: started.transactionId,
        expectedUserId: await seedUserId(e2e),
      })
      .expect(200);
    const approvalBody = approval.body as AuthorizeActionBody;
    expect(approvalBody.success).toBe(true);
    expect(Object.keys(approvalBody).sort()).toEqual(['data', 'success']);
    expect(Object.keys(approvalBody.data)).toEqual(['redirectUri']);

    const callback = new URL(approvalBody.data.redirectUri);
    const code = callback.searchParams.get('code');
    expect(callback.protocol).toBe('myapp:');
    expect(callback.hostname).toBe('callback');
    expect([...callback.searchParams.keys()].sort()).toEqual(['code', 'state']);
    expect(callback.searchParams.get('state')).toBe('state-1');
    expect(code).toBeTruthy();

    const exchange = await request(e2e.httpServer)
      .post('/api/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code,
        redirect_uri: NATIVE_REDIRECT,
        client_id: NATIVE_CLIENT_ID,
        code_verifier: started.verifier,
      })
      .expect(200);
    const tokenBody = exchange.body as TokenResponseBody;
    expect(typeof tokenBody.access_token).toBe('string');

    const protectedRoute = await request(e2e.httpServer)
      .patch('/api/user/profile')
      .set('Authorization', `Bearer ${tokenBody.access_token}`)
      .set('Origin', 'https://native-client.invalid')
      .send({ name: 'Native Journey User' })
      .expect(200);
    expect(protectedRoute.body.data.name).toBe('Native Journey User');

    const nextRequest = await beginNativeAuthorization(e2e);
    const alreadyGranted = await browser
      .get(`/api/oauth/authorize/transaction/${nextRequest.transactionId}`)
      .expect(200);
    expect(alreadyGranted.body.data.alreadyGranted).toBe(true);

    const repeated = await browser.post('/api/oauth/authorize/approve').send({
      transactionId: started.transactionId,
      expectedUserId: await seedUserId(e2e),
    });
    expect(repeated.status).toBe(404);
    expect((repeated.body as ApiErrorBody).error.code).toBe(
      ErrorCode.NATIVE_TRANSACTION_EXPIRED,
    );
  });

  it('denies with the stored state and ends the transaction', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const started = await beginNativeAuthorization(e2e);
    const denied = await browser
      .post('/api/oauth/authorize/deny')
      .send({
        transactionId: started.transactionId,
        expectedUserId: await seedUserId(e2e),
      })
      .expect(200);
    const deniedBody = denied.body as AuthorizeActionBody;
    const callback = new URL(deniedBody.data.redirectUri);
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe('state-1');
    expect([...callback.searchParams.keys()].sort()).toEqual([
      'error',
      'state',
    ]);

    const read = await browser.get(
      `/api/oauth/authorize/transaction/${started.transactionId}`,
    );
    expect(read.status).toBe(404);
    expect((read.body as ApiErrorBody).error.code).toBe(
      ErrorCode.NATIVE_TRANSACTION_EXPIRED,
    );

    const approval = await browser.post('/api/oauth/authorize/approve').send({
      transactionId: started.transactionId,
      expectedUserId: await seedUserId(e2e),
    });
    expect(approval.status).toBe(404);
    expect((approval.body as ApiErrorBody).error.code).toBe(
      ErrorCode.NATIVE_TRANSACTION_EXPIRED,
    );
  });

  it('returns the expired answer for unknown and elapsed transactions', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const readId = await beginNativeAuthorization(e2e);
    const approveId = await beginNativeAuthorization(e2e);
    const denyId = await beginNativeAuthorization(e2e);
    e2e.clock.advance(PENDING_AUTH_LIFETIME_MS);

    const unknown = await browser.get(
      '/api/oauth/authorize/transaction/unknown-transaction',
    );
    const expiredRead = await browser.get(
      `/api/oauth/authorize/transaction/${readId.transactionId}`,
    );
    const expiredApprove = await browser
      .post('/api/oauth/authorize/approve')
      .send({
        transactionId: approveId.transactionId,
        expectedUserId: await seedUserId(e2e),
      });
    const expiredDeny = await browser.post('/api/oauth/authorize/deny').send({
      transactionId: denyId.transactionId,
      expectedUserId: await seedUserId(e2e),
    });

    for (const response of [
      unknown,
      expiredRead,
      expiredApprove,
      expiredDeny,
    ]) {
      expect(response.status).toBe(404);
      expect((response.body as ApiErrorBody).error.code).toBe(
        ErrorCode.NATIVE_TRANSACTION_EXPIRED,
      );
    }
  });

  it('returns expired for a disabled app and disabled for the feature switch', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const disabledApp = await beginNativeAuthorization(e2e);
    await e2e.state.applications.changeApplication(NATIVE_CLIENT_ID, {
      enabled: false,
    });
    const appRead = await browser.get(
      `/api/oauth/authorize/transaction/${disabledApp.transactionId}`,
    );
    expect(appRead.status).toBe(404);
    expect((appRead.body as ApiErrorBody).error.code).toBe(
      ErrorCode.NATIVE_TRANSACTION_EXPIRED,
    );

    await e2e.state.applications.changeApplication(NATIVE_CLIENT_ID, {
      enabled: true,
    });
    const readId = await beginNativeAuthorization(e2e);
    const approveId = await beginNativeAuthorization(e2e);
    const denyId = await beginNativeAuthorization(e2e);
    e2e.app.get(ConfigService).set('auth.nativeEnabled', false);

    const responses = await Promise.all([
      browser.get(`/api/oauth/authorize/transaction/${readId.transactionId}`),
      browser.post('/api/oauth/authorize/approve').send({
        transactionId: approveId.transactionId,
        expectedUserId: await seedUserId(e2e),
      }),
      browser.post('/api/oauth/authorize/deny').send({
        transactionId: denyId.transactionId,
        expectedUserId: await seedUserId(e2e),
      }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect((response.body as ApiErrorBody).error.code).toBe(
        ErrorCode.NATIVE_AUTH_DISABLED,
      );
    }
  });
});

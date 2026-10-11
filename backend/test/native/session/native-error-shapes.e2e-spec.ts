import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import {
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_USER } from '../../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../../utils/e2e-app';
import {
  createNativeApplication,
  seedUserId,
} from '../../utils/native/native-authorize.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import { TEST_NOW } from '../../utils/frozen-clock';

/**
 * Pins the three failure shapes a mobile client must parse on the native
 * OAuth routes. The shapes are intentionally not unified: OAuth failures use
 * the OAuth shape, browser authorize actions use the application envelope,
 * and throttled requests use the throttling answer.
 *
 * The whole file shares one app booted with a low throttle limit. The
 * throttle budget is cleared before every test, so only the throttling test
 * itself spends it.
 */
describe('native OAuth error shapes (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, { throttleLimit: 10, throttleTtl: 60 });
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

  it('answers OAuth failures in the OAuth shape', async () => {
    const token = await request(e2e.httpServer)
      .post('/api/oauth/token')
      .send({
        grant_type: 'authorization_code',
        code: 'unknown-code',
        redirect_uri: NATIVE_REDIRECT,
        client_id: NATIVE_CLIENT_ID,
        code_verifier: 'a'.repeat(43),
      });
    expect(token.status).toBe(400);
    expect(token.body).toEqual({ error: 'invalid_grant' });

    const authorize = await request(e2e.httpServer).get(
      '/api/oauth/authorize?response_type=code',
    );
    expect(authorize.status).toBe(400);
    expect(authorize.body).toEqual({ error: 'invalid_request' });

    const revoke = await request(e2e.httpServer)
      .post('/api/oauth/revoke')
      .send({});
    expect(revoke.status).toBe(400);
    expect(revoke.body).toEqual({ error: 'invalid_request' });
  });

  it('answers browser authorize failures in the application envelope', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);

    const response = await browser
      .post('/api/oauth/authorize/approve')
      .set('X-Request-Id', 'shape-envelope-probe')
      .send({
        transactionId: 'unknown-transaction',
        expectedUserId: await seedUserId(e2e),
      });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'NATIVE_TRANSACTION_EXPIRED',
        message: 'Native authorization transaction is expired or already ended',
      },
      requestId: 'shape-envelope-probe',
    });
  });

  it('answers throttled requests in the throttling shape', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(e2e.httpServer)
        .post('/api/oauth/token')
        .send({})
        .expect(400);
    }

    const throttled = await request(e2e.httpServer)
      .post('/api/oauth/token')
      .set('X-Request-Id', 'shape-throttle-probe')
      .send({});

    expect(throttled.status).toBe(429);
    expect(throttled.body).toEqual({
      success: false,
      error: {
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests',
        details: { retryAfter: 60 },
      },
      requestId: 'shape-throttle-probe',
    });
  });
});

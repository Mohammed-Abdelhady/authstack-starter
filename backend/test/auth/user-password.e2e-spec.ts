import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { RaceGate } from '../utils/race-gate';
import { SEED_USER } from '../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import {
  createNativeApplication,
  issueNativeGrantFor,
} from '../utils/native/native-authorize.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { TEST_NOW } from '../utils/frozen-clock';

const NEW_PASSWORD = 'NewPassword123!';

describe('password change keeps the calling session (e2e)', () => {
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

  it('lets a bearer caller change its password and keeps only its own session', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const grant = await issueNativeGrantFor(e2e, SEED_USER.email);

    const changed = await request(e2e.httpServer)
      .post('/api/user/password')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .send({ currentPassword: SEED_USER.password, newPassword: NEW_PASSWORD })
      .expect(200);
    expect(changed.body).toEqual({
      success: true,
      data: {
        message:
          'Password changed successfully. Other sessions have been logged out.',
      },
    });

    await request(e2e.httpServer)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .expect(200);

    const ended = await browser.get('/api/user/profile');
    expect(ended.status).toBe(401);

    await loginWithOldPassword(e2e);
    const relogin = await loginWith(e2e, SEED_USER.email, NEW_PASSWORD);
    expect(relogin).toBe(200);
  });

  it('lets a cookie caller change its password and keeps only its own session', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const other = await loginAs(e2e.httpServer, SEED_USER);

    await browser
      .post('/api/user/password')
      .send({ currentPassword: SEED_USER.password, newPassword: NEW_PASSWORD })
      .expect(200);

    await browser.get('/api/user/profile').expect(200);
    const ended = await other.get('/api/user/profile');
    expect(ended.status).toBe(401);
  });

  it('stores the new password when the first transaction attempt is retried', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const gate = new RaceGate();
    const restore = e2e.state.auth.abortNextSessionEndingWrite(gate);
    const changed = browser
      .post('/api/user/password')
      .send({ currentPassword: SEED_USER.password, newPassword: NEW_PASSWORD })
      .expect(200)
      .then((response) => response);
    try {
      await gate.reached();
    } finally {
      gate.release();
    }
    try {
      await changed;
    } finally {
      restore();
    }

    await loginWithOldPassword(e2e);
    expect(await loginWith(e2e, SEED_USER.email, NEW_PASSWORD)).toBe(200);
  });
  it('refuses the eleventh attempt of one client in fifteen minutes, right password or not', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const attempt = (currentPassword: string) =>
      browser
        .post('/api/user/password')
        .send({ currentPassword, newPassword: NEW_PASSWORD });

    const guesses: { status: number; code: string }[] = [];
    for (let guess = 0; guess < 10; guess += 1) {
      const answer = await attempt('NotThePassword1!');
      guesses.push({
        status: answer.status,
        code: (answer.body as { error: { code: string } }).error.code,
      });
    }
    const eleventh = await attempt(SEED_USER.password);

    expect(guesses).toEqual(
      Array.from({ length: 10 }, () => ({
        status: 400,
        code: 'INVALID_CURRENT_PASSWORD',
      })),
    );
    expect({
      status: eleventh.status,
      code: (eleventh.body as { error: { code: string } }).error.code,
    }).toEqual({ status: 429, code: 'RATE_LIMIT_EXCEEDED' });
    // The password the last attempt carried was not stored.
    expect(await loginWith(e2e, SEED_USER.email, NEW_PASSWORD)).toBe(401);
  });
});

async function loginWithOldPassword(e2e: E2eApp): Promise<void> {
  expect(await loginWith(e2e, SEED_USER.email, SEED_USER.password)).toBe(401);
}

async function loginWith(
  e2e: E2eApp,
  email: string,
  password: string,
): Promise<number> {
  const agent = request.agent(e2e.httpServer);
  const proof = await agent.get('/api/auth/browser-proof').expect(200);
  const token = (proof.body as { data: { token: string } }).data.token;
  const response = await agent
    .post('/api/auth/login')
    .set(CSRF_HEADER, token)
    .send({ email, password });
  return response.status;
}

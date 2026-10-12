import request from 'supertest';
import type { Response } from 'supertest';
import { bootE2eApp, type E2eApp } from '../utils/e2e-app';
import { SEED_USER } from '../constants/seed-users';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

describe('sign-in cookie ordering (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('answers a role lookup failure with no cookie and no session row', async () => {
    const agent = request.agent(e2e.httpServer);
    const proof = await agent.get('/api/auth/browser-proof').expect(200);
    const preAuth = (proof.body as { data: { token: string } }).data.token;

    const restore = e2e.state.auth.failNextRoleRead();
    let response: Response;
    try {
      response = await agent
        .post('/api/auth/login')
        .set(CSRF_HEADER, preAuth)
        .send({ email: SEED_USER.email, password: SEED_USER.password });
    } finally {
      restore();
    }

    expect(response.status).toBe(500);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });
});

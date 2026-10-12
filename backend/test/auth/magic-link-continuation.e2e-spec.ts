import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { ConfigService } from '@nestjs/config';
import { SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { TEST_NOW } from '../utils/frozen-clock';

describe('magic-link native continuation (e2e)', () => {
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
    e2e.app.get(ConfigService).set('magicLink.enabled', true);
  });

  it('carries an allowed continuation from request through verification', async () => {
    const redirect = '/en/auth/native/authorize?transaction=abc-123';
    const requester = await browserAgent(e2e.httpServer);
    await requester
      .post('/api/auth/magic-link/request')
      .send({ email: SEED_USER.email, redirect })
      .expect(200);
    const token = latestMagicLinkToken(e2e);

    const proof = await proofFor(requester);
    const verified = await requester
      .post('/api/auth/magic-link/verify')
      .set(CSRF_HEADER, proof)
      .send({ token })
      .expect(200);
    expect(verified.body.data.redirect).toBe(redirect);
  });

  it('ignores a disallowed continuation and omits it after verification', async () => {
    const requester = await browserAgent(e2e.httpServer);
    await requester
      .post('/api/auth/magic-link/request')
      .send({
        email: SEED_USER.email,
        redirect: '/en/auth/native/authorize?transaction=abc&extra=yes',
      })
      .expect(200);
    const token = latestMagicLinkToken(e2e);

    const proof = await proofFor(requester);
    const verified = await requester
      .post('/api/auth/magic-link/verify')
      .set(CSRF_HEADER, proof)
      .send({ token })
      .expect(200);
    expect(verified.body.data).not.toHaveProperty('redirect');
  });
});

function latestMagicLinkToken(e2e: E2eApp): string {
  const message = e2e.mail.at(-1);
  const link = message?.text?.match(/https?:\/\/[^\s]+/)?.[0];
  if (!link) {
    throw new Error('Magic link mail has no sign-in URL');
  }
  const token = new URL(link).searchParams.get('token');
  if (!token) {
    throw new Error('Magic link URL has no token');
  }
  return token;
}

/** A browser proof works once, so a browser fetches one before each anonymous post. */
async function proofFor(browser: TestAgent): Promise<string> {
  const proof = await browser.get('/api/auth/browser-proof').expect(200);
  return (proof.body as { data: { token: string } }).data.token;
}

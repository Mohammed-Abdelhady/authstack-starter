import type { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { HashService } from '../../src/common/services/hash.service';
import { MailService } from '../../src/mail/mail.service';
import { PENDING_PURPOSE } from '../../src/auth/constants/registration';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const CODE = '123456';
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);

/**
 * Each anonymous branch must do exactly one hash and answer without waiting
 * for the SMTP round trip. The mail send is held open here to prove it.
 */
describe('Anonymous mail is off the response path (e2e)', () => {
  let e2e: E2eApp;
  let hashSpy: jest.SpyInstance;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    hashSpy = jest.spyOn(HashService.prototype, 'hash');
  });

  afterEach(async () => {
    await e2e.captureMail();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function post(
    path: string,
    body: Record<string, string>,
  ): Promise<Response> {
    const agent = await browserAgent(e2e.httpServer);
    return agent.post(path).send(body);
  }

  /**
   * Hold the mail send open, run the request, and assert the answer returned
   * while the send was still pending, with exactly one hash spent.
   */
  async function expectOffPath(
    request: () => Promise<Response>,
  ): Promise<void> {
    const mailService = e2e.app.get(MailService);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    jest.spyOn(mailService, 'sendMail').mockImplementation(async () => {
      await gate;
      settled = true;
    });

    const response = await request();

    try {
      expect(response.status).toBe(200);
      expect(settled).toBe(false);
      expect(hashSpy).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await e2e.captureMail();
    }

    expect(settled).toBe(true);
  }

  it('register for a free address hashes once and returns before the mail settles', async () => {
    await expectOffPath(() =>
      post('/api/auth/register', { email: 'free@example.test' }),
    );
  });

  it('register for a verified address hashes once and returns before the notice settles', async () => {
    await e2e.state.accounts.createAccount({
      email: 'taken@example.test',
      name: 'Taken',
      isVerified: true,
    });

    await expectOffPath(() =>
      post('/api/auth/register', { email: 'taken@example.test' }),
    );
  });

  it('resend hashes once and returns before the mail settles', async () => {
    await e2e.state.auth.storePendingRegistration({
      email: 'pending@example.test',
      purpose: PENDING_PURPOSE.SIGNUP,
      hashedCode: await bcrypt.hash(CODE, 4),
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
    });

    await expectOffPath(() =>
      post('/api/auth/resend-activation', { email: 'pending@example.test' }),
    );
  });

  it('forgot-password for a known address hashes once and returns before the mail settles', async () => {
    await e2e.state.accounts.createAccount({
      email: 'known@example.test',
      name: 'Known',
      isVerified: true,
      password: await bcrypt.hash('Password123!', 4),
    });

    await expectOffPath(() =>
      post('/api/auth/forgot-password', { email: 'known@example.test' }),
    );
  });
});

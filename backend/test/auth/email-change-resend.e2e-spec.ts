import type { Response } from 'supertest';
import { PENDING_PURPOSE } from '../../src/auth/constants/registration';
import {
  bootE2eApp,
  browserAgent,
  loginAs,
  E2E_CLIENT_URL,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import {
  EMAIL_CHANGE_CONFIRM_PATH,
  EMAIL_CHANGE_EMAIL_SUBJECT,
} from '../../src/mail/constants/mail.constants';
import { SEED_ADMIN } from '../constants/seed-users';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const MAX_ATTEMPTS = 5;

describe('Admin email change confirmation (e2e)', () => {
  let e2e: E2eApp;
  let adminAgent: TestAgent;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    // reset clears sessions, so the admin signs in again for each case.
    adminAgent = await loginAs(e2e.httpServer, SEED_ADMIN);
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function createTarget(email = 'orig@example.test') {
    return e2e.state.accounts.createAccount({
      email,
      name: 'Target User',
      role: 'user',
      isVerified: true,
      addressGeneration: 0,
    });
  }

  function move(id: string, email: string): Promise<Response> {
    return adminAgent.patch(`/api/admin/users/${id}`).send({ email });
  }

  function confirm(email: string, code: string): Promise<Response> {
    return browserAgent(e2e.httpServer).then((agent) =>
      agent.post('/api/auth/confirm-email-change').send({ email, code }),
    );
  }

  async function latestCode(): Promise<string> {
    await e2e.captureMail();
    return await e2e.mailedCode();
  }

  it('confirms after a move away and back inside the code lifetime', async () => {
    const target = await createTarget();
    const id = target._id.toString();

    await move(id, 'x@example.test');
    await move(id, 'y@example.test');
    await move(id, 'x@example.test');

    // The account stays on its own address until the code is confirmed.
    const stored = await e2e.state.accounts.accountWithId(target._id);
    expect(stored?.email).toBe('orig@example.test');
    expect(stored?.addressGeneration).toBe(3);
    expect(stored?.isVerified).toBe(true);

    const record =
      await e2e.state.auth.pendingRegistrationFor('x@example.test');
    expect(record?.addressGeneration).toBe(3);
    expect(record?.purpose).toBe(PENDING_PURPOSE.EMAIL_CHANGE);

    const code = await latestCode();
    const response = await confirm('x@example.test', code);
    expect(response.status).toBe(200);

    const confirmed = await e2e.state.accounts.accountWithId(target._id);
    expect(confirmed?.email).toBe('x@example.test');
    expect(confirmed?.isVerified).toBe(true);
  });

  it('re-sends a confirmation after the attempts are exhausted, resetting them', async () => {
    const target = await createTarget();
    const id = target._id.toString();
    await move(id, 'moved@example.test');

    const code = await latestCode();
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await confirm('moved@example.test', '000000');
    }
    const locked =
      await e2e.state.auth.pendingRegistrationFor('moved@example.test');
    expect(locked?.attempts).toBe(MAX_ATTEMPTS);

    const before = (await e2e.captureMail()).length;
    const resent = await adminAgent
      .post(`/api/admin/users/${id}/resend-email-change`)
      .send({});
    expect(resent.status).toBe(200);
    await e2e.captureMail();
    expect((await e2e.captureMail()).length - before).toBe(1);

    const refreshed =
      await e2e.state.auth.pendingRegistrationFor('moved@example.test');
    expect(refreshed?.attempts).toBe(0);

    const freshCode = await latestCode();
    expect(freshCode).not.toBe(code);
    const response = await confirm('moved@example.test', freshCode);
    expect(response.status).toBe(200);
    expect((await e2e.state.accounts.accountWithId(target._id))?.email).toBe(
      'moved@example.test',
    );
  });

  it('names the change and links to the confirmation page in the mail', async () => {
    const target = await createTarget();
    await move(target._id.toString(), 'moved@example.test');
    await e2e.captureMail();

    const confirmUrl = `${E2E_CLIENT_URL}${EMAIL_CHANGE_CONFIRM_PATH}`;
    const mail = (await e2e.captureMail()).at(-1);
    expect(mail?.subject).toBe(EMAIL_CHANGE_EMAIL_SUBJECT);
    expect(mail?.text).toContain(confirmUrl);
    expect(mail?.html).toContain(`href="${confirmUrl}"`);
    expect(mail?.text).not.toContain('registering');
  });

  it('refuses to re-send for an account with no address waiting', async () => {
    const target = await createTarget();

    const response = await adminAgent
      .post(`/api/admin/users/${target._id.toString()}/resend-email-change`)
      .send({});

    expect(response.status).toBe(400);
  });
});

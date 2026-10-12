import type { Response } from 'supertest';
import {
  MAIL_COUNTER_PURPOSE,
  PENDING_PURPOSE,
} from '../../src/auth/constants/registration';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import { REGISTRATION_NOTICE_EMAIL_SUBJECT } from '../../src/mail/constants/mail.constants';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

describe('Registration limits (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
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

  it('answers a soft-deleted address like a taken one and mails nothing', async () => {
    const email = 'deleted@example.test';
    await e2e.state.accounts.createAccount({
      email,
      name: 'Deleted',
      isVerified: true,
      isDeleted: true,
    });

    const before = (await e2e.captureMail()).length;
    const registered = await post('/api/auth/register', { email });
    const resent = await post('/api/auth/resend-activation', { email });
    await e2e.captureMail();

    expect(registered.status).toBe(200);
    expect(resent.status).toBe(200);
    expect((await e2e.captureMail()).length - before).toBe(0);
    expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(0);
  });

  it('answers an unverified existing account like a taken one on register and resend', async () => {
    const email = 'unverified@example.test';
    await e2e.state.accounts.createAccount({
      email,
      name: 'Moved',
      isVerified: false,
      addressGeneration: 1,
    });

    const before = (await e2e.captureMail()).length;
    const registered = await post('/api/auth/register', { email });
    const resent = await post('/api/auth/resend-activation', { email });
    const mails = (await e2e.captureMail()).slice(before);

    expect(registered.status).toBe(200);
    expect(resent.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe(REGISTRATION_NOTICE_EMAIL_SUBJECT);
    expect(
      await e2e.state.auth.countPendingRegistrations(
        email,
        PENDING_PURPOSE.SIGNUP,
      ),
    ).toBe(0);
  });

  it('answers an over-cap address with the same shape as a normal registration', async () => {
    const capped = 'capped@example.test';
    await e2e.state.auth.storeMailCounter({
      email: capped,
      purpose: MAIL_COUNTER_PURPOSE.SIGNUP,
      mailedCodes: 5,
    });

    const normal = await post('/api/auth/register', {
      email: 'normal@example.test',
    });
    const overCap = await post('/api/auth/register', { email: capped });
    await e2e.captureMail();

    expect(overCap.status).toBe(normal.status);
    expect(overCap.body).toMatchObject({
      success: normal.body.success,
      message: normal.body.message,
    });
    expect(
      (await e2e.captureMail()).filter((item) => item.to === capped),
    ).toHaveLength(0);
    expect(
      (await e2e.captureMail()).filter(
        (item) => item.to === 'normal@example.test',
      ),
    ).toHaveLength(1);
  });

  it('answers an over-cap reset address like an unknown one and mails nothing', async () => {
    const capped = 'reset-capped@example.test';
    await e2e.state.accounts.createAccount({
      email: capped,
      name: 'Known',
      isVerified: true,
    });
    await e2e.state.auth.storeMailCounter({
      email: capped,
      purpose: MAIL_COUNTER_PURPOSE.PASSWORD_RESET,
      mailedCodes: 5,
    });

    const cappedResponse = await post('/api/auth/forgot-password', {
      email: capped,
    });
    const unknownResponse = await post('/api/auth/forgot-password', {
      email: 'unknown-reset@example.test',
    });
    await e2e.captureMail();

    expect(cappedResponse.status).toBe(200);
    expect(cappedResponse.body).toMatchObject({
      success: unknownResponse.body.success,
      message: unknownResponse.body.message,
    });
    expect(
      (await e2e.captureMail()).filter((item) => item.to === capped),
    ).toHaveLength(0);
  });
});

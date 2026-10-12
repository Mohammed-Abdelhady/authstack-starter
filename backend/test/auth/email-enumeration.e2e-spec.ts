import { Logger } from '@nestjs/common';
import type { Response } from 'supertest';
import {
  GENERIC_CODE_SENT_MESSAGE,
  PASSWORD_RESET_EMAIL_FAILED_MESSAGE,
} from '../../src/auth/constants/auth-messages';
// feature:magic-link:start
import { MAIL_COUNTER_PURPOSE } from '../../src/auth/constants/registration';
import { MAGIC_LINK_MAX_PER_HOUR } from '../../src/auth/magic-link/magic-link-limits.harness-spec';
import { MAGIC_LINK_SENT_MESSAGE } from '../../src/auth/magic-link/constants/magic-link.constants';
// feature:magic-link:end
import { REQUEST_ID_HEADER } from '../../src/common/constants/request-id';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { VOLATILE_HEADERS } from '../utils/stable-answer'; // feature:magic-link
import { expectSameAnswer } from '../utils/stable-answer';

/** Success body every address-request route returns. */
interface AddressRequestResponse {
  success: true;
  data: { email: string };
  message: string;
}

/**
 * The routes that take an address from a signed-out caller and mail it.
 * The mail boundary is made to fail, which is the condition that used to turn
 * an existing account into a different answer from an unknown address.
 */
describe('Address-request routes with a failing mail boundary (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      failMail: true,
      magicLinkEnabled: true, // feature:magic-link
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function post(
    path: string,
    body: Record<string, string>,
  ): Promise<Response> {
    const agent = await browserAgent(e2e.httpServer);
    return agent.post(path).send(body);
  }

  function createVerifiedAccount(email: string): Promise<unknown> {
    return e2e.state.accounts.createAccount({
      email,
      name: 'Existing Account',
      isVerified: true,
    });
  }

  // feature:magic-link:start
  /** The address has one link of its hour left. */
  async function seedLastMagicLinkOfTheHour(email: string): Promise<void> {
    await e2e.state.auth.storeMailCounter({
      email,
      purpose: MAIL_COUNTER_PURPOSE.MAGIC_LINK,
      mailedCodes: MAGIC_LINK_MAX_PER_HOUR - 1,
    });
  }

  /**
   * A link request always leaves the browser its nonce, so two answers are
   * the same when that cookie differs in its value and in nothing else.
   */
  function expectSameLinkAnswer(actual: Response, expected: Response): void {
    const seen = (response: Response) => ({
      status: response.status,
      text: response.text,
      cookies: (response.get('Set-Cookie') ?? []).map((cookie) =>
        cookie.replace(/^([^=]+)=[^;]*/, '$1=').replace(/; Expires=[^;]*/, ''),
      ),
      headers: Object.fromEntries(
        Object.entries(response.headers).filter(
          ([name]) =>
            name !== 'set-cookie' && !VOLATILE_HEADERS.has(name.toLowerCase()),
        ),
      ),
    });
    expect(seen(actual)).toEqual(seen(expected));
    expect(seen(actual).cookies).toEqual([
      'ml_nonce=; Max-Age=900; Path=/; HttpOnly; SameSite=Strict',
    ]);
  }
  // feature:magic-link:end

  it('answers forgot-password the same for a real address and an unknown one', async () => {
    const email = 'forgot-enum@example.test';

    const unknownBefore = (await e2e.captureMail()).length;
    const unknown = await post('/api/auth/forgot-password', { email });
    expect((await e2e.captureMail()).length - unknownBefore).toBe(0);

    await createVerifiedAccount(email);

    const knownBefore = (await e2e.captureMail()).length;
    const known = await post('/api/auth/forgot-password', { email });
    expect((await e2e.captureMail()).length - knownBefore).toBe(1);

    expectSameAnswer(known, unknown);
    expect(unknown.body as AddressRequestResponse).toEqual({
      success: true,
      data: { email },
      message: GENERIC_CODE_SENT_MESSAGE,
    });
  });

  it('answers resend-activation the same with and without a pending registration', async () => {
    const email = 'resend-enum@example.test';

    const unknownBefore = (await e2e.captureMail()).length;
    const unknown = await post('/api/auth/resend-activation', { email });
    expect((await e2e.captureMail()).length - unknownBefore).toBe(0);

    await e2e.state.auth.storePendingRegistration({
      email,
      purpose: 'signup',
      hashedCode: 'a-hashed-code',
      attempts: 0,
      expiresAt: new Date(TEST_NOW.getTime() + 15 * 60 * 1000),
    });

    const pendingBefore = (await e2e.captureMail()).length;
    const pending = await post('/api/auth/resend-activation', { email });
    expect((await e2e.captureMail()).length - pendingBefore).toBe(1);

    expectSameAnswer(pending, unknown);
    expect(unknown.body as AddressRequestResponse).toEqual({
      success: true,
      data: { email },
      message: GENERIC_CODE_SENT_MESSAGE,
    });
  });

  it('answers register the same for a taken address and a free one', async () => {
    const email = 'register-enum@example.test';

    const freeBefore = (await e2e.captureMail()).length;
    const free = await post('/api/auth/register', { email });
    expect((await e2e.captureMail()).length - freeBefore).toBe(1);

    // Clear the free sign-up record so the taken path can be checked alone.
    await e2e.state.auth.removeEveryPendingRegistration(email);
    await createVerifiedAccount(email);

    const takenBefore = (await e2e.captureMail()).length;
    const taken = await post('/api/auth/register', { email });
    expect((await e2e.captureMail()).length - takenBefore).toBe(1);

    expectSameAnswer(taken, free);
    expect(free.body as AddressRequestResponse).toEqual({
      success: true,
      data: { email },
      message: GENERIC_CODE_SENT_MESSAGE,
    });

    // The taken address gets the notice, not an activation code, and no
    // sign-up record is created for it.
    const takenMail = (await e2e.captureMail()).at(-1);
    expect(takenMail?.subject).toBe(
      'Someone tried to register with your email address',
    );
    expect(takenMail?.html).toBeUndefined();
    expect(
      await e2e.state.auth.countPendingRegistrations(email, 'signup'),
    ).toBe(0);
  });

  it('mails nothing for forgot-password on a soft-deleted account', async () => {
    const email = 'forgot-deleted@example.test';
    await e2e.state.accounts.createAccount({
      email,
      name: 'Deleted Account',
      isVerified: true,
      isDeleted: true,
    });

    const before = (await e2e.captureMail()).length;
    const response = await post('/api/auth/forgot-password', { email });

    expect(response.status).toBe(200);
    expect((await e2e.captureMail()).length - before).toBe(0);
  });

  it('mails nothing on resend for a verified account', async () => {
    const email = 'resend-verified@example.test';
    await createVerifiedAccount(email);

    const before = (await e2e.captureMail()).length;
    const response = await post('/api/auth/resend-activation', { email });

    expect(response.status).toBe(200);
    expect((await e2e.captureMail()).length - before).toBe(0);
  });

  // feature:magic-link:start
  it('answers a magic-link request the same for a real address and an unknown one', async () => {
    const email = 'magic-enum@example.test';

    const unknownBefore = (await e2e.captureMail()).length;
    const unknown = await post('/api/auth/magic-link/request', { email });
    expect((await e2e.captureMail()).length - unknownBefore).toBe(1);

    await createVerifiedAccount(email);

    const knownBefore = (await e2e.captureMail()).length;
    const known = await post('/api/auth/magic-link/request', { email });
    expect((await e2e.captureMail()).length - knownBefore).toBe(1);

    expectSameLinkAnswer(known, unknown);
    expect(unknown.body as AddressRequestResponse).toEqual({
      success: true,
      data: { email },
      message: MAGIC_LINK_SENT_MESSAGE,
    });
  });

  it('answers a soft-deleted magic-link request the same as a mailed one', async () => {
    const email = 'magic-deleted-enum@example.test';

    const mailedBefore = (await e2e.captureMail()).length;
    const mailed = await post('/api/auth/magic-link/request', { email });
    expect((await e2e.captureMail()).length - mailedBefore).toBe(1);

    await e2e.state.accounts.createAccount({
      email,
      name: 'Deleted Account',
      isDeleted: true,
    });

    const deletedBefore = (await e2e.captureMail()).length;
    const deleted = await post('/api/auth/magic-link/request', { email });
    expect((await e2e.captureMail()).length - deletedBefore).toBe(0);

    expectSameLinkAnswer(deleted, mailed);
    expect(deleted.body as AddressRequestResponse).toEqual({
      success: true,
      data: { email },
      message: MAGIC_LINK_SENT_MESSAGE,
    });
  });

  it('answers a magic-link request over the hourly cap the same as a mailed one', async () => {
    const email = 'magic-cap-enum@example.test';

    await seedLastMagicLinkOfTheHour(email);

    const mailedBefore = (await e2e.captureMail()).length;
    const mailed = await post('/api/auth/magic-link/request', { email });
    expect((await e2e.captureMail()).length - mailedBefore).toBe(1);

    const cappedBefore = (await e2e.captureMail()).length;
    const capped = await post('/api/auth/magic-link/request', { email });
    expect((await e2e.captureMail()).length - cappedBefore).toBe(0);

    expectSameLinkAnswer(capped, mailed);
    expect(capped.body as AddressRequestResponse).toEqual({
      success: true,
      data: { email },
      message: MAGIC_LINK_SENT_MESSAGE,
    });
  });

  it('does not log a sent line when the link could not be mailed', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const email = 'magic-log-enum@example.test';

    const before = (await e2e.captureMail()).length;
    await post('/api/auth/magic-link/request', { email });
    expect((await e2e.captureMail()).length - before).toBe(1);

    const logged = logSpy.mock.calls.map((call) =>
      call.map((argument) => String(argument)).join(' '),
    );
    expect(
      logged.filter((line) => line.includes('Magic link sent to')),
    ).toEqual([]);
  });
  // feature:magic-link:end

  it('logs the delivery failure with the request id, and this service logs no address', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const email = 'log-enum@example.test';
    await createVerifiedAccount(email);

    const before = (await e2e.captureMail()).length;
    const response = await (
      await browserAgent(e2e.httpServer)
    )
      .post('/api/auth/forgot-password')
      .set(REQUEST_ID_HEADER, 'enum-log-request-id')
      .send({ email });
    expect((await e2e.captureMail()).length - before).toBe(1);

    expect(response.status).toBe(200);
    const logged = errorSpy.mock.calls.map((call) =>
      call.map((argument) => String(argument)).join(' '),
    );
    expect(logged).toContain(
      `${PASSWORD_RESET_EMAIL_FAILED_MESSAGE} requestId=enum-log-request-id cause=Error`,
    );
    expect(logged.filter((line) => line.includes(email))).toEqual([]);
  });
});

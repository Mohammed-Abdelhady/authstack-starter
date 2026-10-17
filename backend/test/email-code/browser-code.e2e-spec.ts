import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_USER } from '../constants/seed-users';
import { browserAgent, type E2eApp } from '../utils/e2e-app';
import { storedBrowserSession } from '../utils/session/stored-browser-session';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  askCode,
  bootBrowserCodeApp,
  CODE_LIFETIME_MS,
  CODE_REQUEST,
  CODE_VERIFY,
  nonceOf,
  otherCode,
  postCode,
  responseCookies,
  rawVerifyCode,
  sessionOf,
  storedCode,
  verifyCode,
} from './browser-code.fixtures';

describe('browser email code ceremony', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootBrowserCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    const config = e2e.app.get(ConfigService);
    config.set('emailCode.enabled', true);
    config.set('auth.web.signIn', {});
    config.set('magicLink.maxPerHour', 5);
  });
  afterEach(() => jest.restoreAllMocks());

  it('crosses mail and cookie into one persisted email-code session with links disabled', async () => {
    e2e.app
      .get(ConfigService)
      .set('auth.web.signIn', { emailCode: true, emailLink: false });
    const browser = await browserAgent(e2e.httpServer);
    const { answer, mail } = await askCode(e2e, browser, {
      email: ` ${SEED_USER.email.toUpperCase()} `,
    });
    expect(answer.body).toEqual({
      success: true,
      data: { email: SEED_USER.email },
    });
    expect(mail.to).toBe(SEED_USER.email);
    expect(responseCookies(answer)).toEqual([
      expect.stringMatching(
        /^ec_nonce=[A-Za-z0-9_-]{43}; Max-Age=600; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Strict$/u,
      ),
    ]);
    expect((await storedCode(e2e, nonceOf(answer)))?.spentAt).toBeNull();
    const verified = await verifyCode(browser, mail.code);
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({
      data: { requiresTwoFactor: false, user: { email: SEED_USER.email } },
    });
    expect(
      await storedBrowserSession(e2e.app, sessionOf(verified)),
    ).toMatchObject({
      clientId: 'web',
      authenticationMethods: ['email_code'],
      userVerified: false,
      policyVersion: 0,
    });
    expect((await storedCode(e2e, nonceOf(answer)))?.spentAt).toEqual(TEST_NOW);
    expect((await verifyCode(browser, mail.code)).status).toBe(400);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });

  it('refuses another browser and a malformed cookie without spending the real ceremony', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { answer, mail } = await askCode(e2e, browser);
    const other = await browserAgent(e2e.httpServer);
    const refused = await verifyCode(other, mail.code);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      error: { code: ErrorCode.EMAIL_CODE_INVALID },
    });
    const malformed = await rawVerifyCode(e2e, {
      nonce: 'ec_nonce=malformed',
      code: mail.code,
    });
    expect(malformed.status).toBe(400);
    expect((await storedCode(e2e, nonceOf(answer)))?.spentAt).toBeNull();
    expect((await verifyCode(browser, mail.code)).status).toBe(200);
  });

  it('ends the fifth wrong guess only for that ceremony and admits a fresh request', async () => {
    const first = await browserAgent(e2e.httpServer);
    const other = await browserAgent(e2e.httpServer);
    const original = await askCode(e2e, first);
    const attacked = await askCode(e2e, other);
    for (let guess = 1; guess <= 5; guess += 1) {
      expect(
        (await verifyCode(other, otherCode(attacked.mail.code))).status,
      ).toBe(400);
      expect(
        (await storedCode(e2e, nonceOf(attacked.answer)))?.wrongGuesses,
      ).toBe(guess);
    }
    expect((await verifyCode(other, attacked.mail.code)).status).toBe(400);
    const fresh = await askCode(e2e, other);
    expect((await verifyCode(other, fresh.mail.code)).status).toBe(200);
    expect((await verifyCode(first, original.mail.code)).status).toBe(200);
    expect(await e2e.state.sessions.countSessions()).toBe(2);
  });

  it('invalidates a resend code even if its old cookie is replayed and refuses exact expiry', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const first = await askCode(e2e, browser);
    const second = await askCode(e2e, browser);
    expect((await storedCode(e2e, nonceOf(first.answer)))?.spentAt).toEqual(
      TEST_NOW,
    );
    const old = await rawVerifyCode(e2e, {
      nonce: nonceOf(first.answer),
      code: first.mail.code,
    });
    expect(old.status).toBe(400);
    e2e.clock.advance(CODE_LIFETIME_MS);
    expect((await verifyCode(browser, second.mail.code)).status).toBe(400);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  it('issues once when two independent HTTP proofs verify the same cookie and code', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { answer, mail } = await askCode(e2e, browser);
    const results = await Promise.all([
      rawVerifyCode(e2e, { nonce: nonceOf(answer), code: mail.code }),
      rawVerifyCode(e2e, { nonce: nonceOf(answer), code: mail.code }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });

  it('rolls code spending back when a real session write fails and allows the mailed code afterward', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { answer, mail } = await askCode(e2e, browser);
    const restore = e2e.state.auth.failNextRoleRead();
    const failed = await verifyCode(browser, mail.code);
    restore();
    expect(failed.status).toBe(500);
    expect(
      responseCookies(failed).some((cookie) => cookie.startsWith('sid=')),
    ).toBe(false);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expect((await storedCode(e2e, nonceOf(answer)))?.spentAt).toBeNull();
    expect((await verifyCode(browser, mail.code)).status).toBe(200);
  });

  it.each([
    { code: '12345' },
    { code: '1234567' },
    { code: 123456 },
    {},
    { code: '１２３４５６' },
    { code: '123456', confirm: true },
  ])('refuses malformed verification %p', async (body) => {
    const browser = await browserAgent(e2e.httpServer);
    expect((await postCode(browser, CODE_VERIFY, { body: body })).status).toBe(
      400,
    );
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  it('keeps discovery and both routes disabled by the global and application flags', async () => {
    for (const global of [true, false]) {
      const config = e2e.app.get(ConfigService);
      config.set('emailCode.enabled', global);
      config.set('auth.web.signIn', { emailCode: !global });
      const browser = await browserAgent(e2e.httpServer);
      const methods = await browser.get('/api/auth/methods');
      expect(methods.body).toMatchObject({
        data: { methods: { emailCode: false, magicLink: false } },
      });
      expect(
        (
          await postCode(browser, CODE_REQUEST, {
            body: { email: SEED_USER.email },
          })
        ).status,
      ).toBe(404);
      expect((await verifyCode(browser, '123456')).status).toBe(404);
    }
  });
});

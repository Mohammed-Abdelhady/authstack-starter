import { SecurityEventStore } from '../../src/session/events/security-event.store';
import { reconcileStartupApplications } from '../../src/session/session.module';
import { MailDispatcherService } from '../../src/mail/mail-dispatcher.service';
import { MAIL_MAX_PENDING_SENDS } from '../../src/mail/constants/mail.constants';
import { ConfigService } from '@nestjs/config';
import { HashService } from '../../src/common/services/hash.service';
import {
  EMAIL_CODE_PURPOSE,
  EmailCodeStore,
} from '../../src/auth/pending-codes/email-code.store';
import { NativeEmailCodeCeilingService } from '../../src/auth/native/lifecycle/native-email-code-ceiling.service';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { browserAgent, type E2eApp } from '../utils/e2e-app';
import { arrangeAudiences } from '../utils/audience-authorization.fixtures';
import { storeBrowserPolicy } from '../utils/session/store-browser-policy';
import { storedBrowserSession } from '../utils/session/stored-browser-session';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  ADMIN_ORIGIN,
  askCode,
  asAnotherCaller,
  bootBrowserCodeApp,
  CODE_REQUEST,
  nonceOf,
  postCode,
  sessionOf,
  storedCode,
  verifyCode,
} from './browser-code.fixtures';

describe('browser email code application and delivery policy', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootBrowserCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    const config = e2e.app.get(ConfigService);
    config.set('auth.web.signIn', {});
    config.set('auth.admin.signIn', {});
    config.set('emailCode.enabled', true);
    config.set('magicLink.maxPerHour', 5);
    await e2e.reset();
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates a verified passwordless account under the open application policy', async () => {
    await arrangeAudiences(e2e, [], { staffApplication: false });
    const browser = await browserAgent(e2e.httpServer);
    const { mail } = await askCode(e2e, browser, {
      email: 'new-code@example.test',
    });
    const result = await verifyCode(browser, mail.code);
    expect(result.status).toBe(200);
    expect(
      await e2e.state.auth.countAccountsWithAddress('new-code@example.test'),
    ).toBe(1);
    expect(
      await e2e.state.accounts.accountWithAddress('new-code@example.test'),
    ).toMatchObject({ audience: 'customer', isVerified: true });
    expect(result.body).toMatchObject({
      data: { user: { email: 'new-code@example.test', isVerified: true } },
    });
    expect(
      await storedBrowserSession(e2e.app, sessionOf(result)),
    ).toMatchObject({ clientId: 'web', authenticationMethods: ['email_code'] });
  });

  it('binds staff sign-in to admin without Origin and refuses an unknown address and customer there', async () => {
    await arrangeAudiences(e2e);
    const browser = await browserAgent(e2e.httpServer);
    const known = await askCode(e2e, browser, {
      email: SEED_ADMIN.email,
      origin: ADMIN_ORIGIN,
    });
    expect(nonceOf(known.answer)).toMatch(/^ec_nonce-admin=/u);
    const signedIn = await verifyCode(browser, known.mail.code, {
      origin: undefined,
      proofOrigin: ADMIN_ORIGIN,
    });
    expect(signedIn.status).toBe(200);
    expect(
      await storedBrowserSession(e2e.app, sessionOf(signedIn, 'admin')),
    ).toMatchObject({
      clientId: 'admin',
      authenticationMethods: ['email_code'],
    });
    const unknown = await browserAgent(e2e.httpServer);
    const mailCount = (await e2e.captureMail()).length;
    const reply = await postCode(unknown, CODE_REQUEST, {
      body: { email: 'unknown@example.test' },
      origin: ADMIN_ORIGIN,
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      success: true,
      data: { email: 'unknown@example.test' },
    });
    expect((await e2e.captureMail()).length).toBe(mailCount);
    expect((await storedCode(e2e, nonceOf(reply)))?.spentAt).toEqual(TEST_NOW);
    expect(
      await e2e.state.auth.countAccountsWithAddress('unknown@example.test'),
    ).toBe(0);
    const customer = await browserAgent(e2e.httpServer);
    const asked = await askCode(e2e, customer, {
      email: SEED_USER.email,
      origin: ADMIN_ORIGIN,
    });
    expect(asked.answer.body).toEqual({
      success: true,
      data: { email: SEED_USER.email },
    });
    expect(
      (await verifyCode(customer, asked.mail.code, { origin: ADMIN_ORIGIN }))
        .status,
    ).toBe(400);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });

  it('stores the unmailed sixth request spent without changing its public reply', async () => {
    const answers: unknown[] = [];
    let finalNonce = '';
    for (let call = 1; call <= 6; call += 1) {
      asAnotherCaller(e2e);
      const browser = await browserAgent(e2e.httpServer);
      const answer = await postCode(browser, CODE_REQUEST, {
        body: {
          email: SEED_USER.email,
        },
      });
      expect(answer.status).toBe(200);
      answers.push(answer.body);
      finalNonce = nonceOf(answer);
    }
    expect((await e2e.captureMail()).length).toBe(5);
    expect(answers).toEqual(
      Array.from({ length: 6 }, () => ({
        success: true,
        data: { email: SEED_USER.email },
      })),
    );
    expect((await storedCode(e2e, finalNonce))?.spentAt).toEqual(TEST_NOW);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  it('leaves no usable code when the bounded dispatcher drops a new mail', async () => {
    const dispatcher = e2e.app.get(MailDispatcherService);
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (let pending = 0; pending < MAIL_MAX_PENDING_SENDS; pending += 1) {
      dispatcher.dispatch(() => blocked, 'Fixture mail gate');
    }
    try {
      const browser = await browserAgent(e2e.httpServer);
      const reply = await postCode(browser, CODE_REQUEST, {
        body: {
          email: SEED_USER.email,
        },
      });
      expect(reply.status).toBe(200);
      expect((await storedCode(e2e, nonceOf(reply)))?.spentAt).toEqual(
        TEST_NOW,
      );
      expect(e2e.mail).toHaveLength(0);
    } finally {
      release();
      await dispatcher.flush();
    }
  });

  it('honors the shared address-day ceiling while keeping an already mailed ceremony usable', async () => {
    const first = await browserAgent(e2e.httpServer);
    const before = await askCode(e2e, first);
    const ceiling = e2e.app.get(NativeEmailCodeCeilingService);
    for (let guess = 0; guess < 100; guess += 1)
      await ceiling.countWrongGuess(SEED_USER.email);
    const other = await browserAgent(e2e.httpServer);
    const capped = await postCode(other, CODE_REQUEST, {
      body: {
        email: SEED_USER.email,
      },
    });
    expect(capped.status).toBe(200);
    expect((await e2e.captureMail()).length).toBe(1);
    expect((await storedCode(e2e, nonceOf(capped)))?.spentAt).toEqual(TEST_NOW);
    expect((await verifyCode(first, before.mail.code)).status).toBe(200);
  });

  it('rechecks tightened required-passkey policy at the transaction that spends the code', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { answer, mail } = await askCode(e2e, browser);
    await storeBrowserPolicy(e2e, 'web', { requirePasskey: true });
    expect((await verifyCode(browser, mail.code)).status).toBe(400);
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('No seeded account');
    expect(
      await e2e.app.get(SecurityEventStore).listRecentForUser(userId, 10),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'passkey_required',
          clientId: 'web',
          targetUserId: userId,
        }),
      ]),
    );

    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expect((await storedCode(e2e, nonceOf(answer)))?.spentAt).toBeNull();
  });

  it('refuses an unknown account when self sign-up closes after its mail was issued', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { answer, mail } = await askCode(e2e, browser, {
      email: 'late-closed@example.test',
    });
    e2e.app.get(ConfigService).set('auth.web.signIn', { signUp: 'closed' });
    await reconcileStartupApplications(e2e.app);
    expect((await verifyCode(browser, mail.code)).status).toBe(400);
    expect(
      await e2e.state.auth.countAccountsWithAddress('late-closed@example.test'),
    ).toBe(0);
    expect((await storedCode(e2e, nonceOf(answer)))?.spentAt).toBeNull();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  it('does not accept a native code from another owner even when both codes share the sign-in purpose', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { answer, mail } = await askCode(e2e, browser);
    const nativeCode = mail.code === '654321' ? '654322' : '654321';
    await e2e.app.get(EmailCodeStore).put({
      ownerId: 'native-attempt-fixture',
      purpose: EMAIL_CODE_PURPOSE.SIGN_IN,
      email: SEED_USER.email,
      codeHash: await e2e.app.get(HashService).hash(nativeCode),
      expiresAt: new Date(TEST_NOW.getTime() + 600000),
      purgeAfter: new Date(TEST_NOW.getTime() + 900000),
      spent: false,
    });
    expect((await verifyCode(browser, nativeCode)).status).toBe(400);
    expect((await storedCode(e2e, nonceOf(answer)))?.spentAt).toBeNull();
    expect((await verifyCode(browser, mail.code)).status).toBe(200);
  });

  // feature:locale-ar:start
  it('uses the Arabic account language and Western digits when the requester asks in English', async () => {
    await e2e.state.accounts.createAccount({
      email: 'arabic-code@example.test',
      name: 'Arabic account',
      locale: 'ar',
      isVerified: true,
    });
    const browser = await browserAgent(e2e.httpServer);
    const { mail } = await askCode(e2e, browser, {
      email: 'arabic-code@example.test',
      locale: 'en',
      mailLocale: 'ar',
    });
    expect(mail.to).toBe('arabic-code@example.test');
    expect(mail.code).toMatch(/^[0-9]{6}$/u);
    expect((await verifyCode(browser, mail.code)).status).toBe(200);
    expect(
      (await e2e.state.accounts.accountWithAddress('arabic-code@example.test'))
        ?.locale,
    ).toBe('ar');
  });
  // feature:locale-ar:end

  it('suppresses neither a deleted address nor a closed sign-up account in the request response', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const id = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!id) throw new Error('No seeded account');
    await e2e.state.records.markAccountDeleted(id);
    const { answer, mail } = await askCode(e2e, browser);
    expect(answer.body).toEqual({
      success: true,
      data: { email: SEED_USER.email },
    });
    expect(
      (await verifyCode(browser, mail.code)).status,
    ).toBeGreaterThanOrEqual(400);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });
});

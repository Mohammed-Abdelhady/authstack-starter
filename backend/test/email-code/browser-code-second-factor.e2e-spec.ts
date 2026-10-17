import { ConfigService } from '@nestjs/config';
import { reconcileStartupApplications } from '../../src/session/session.module';
import { RolePermissions } from '../../src/role/stores/role-permissions';
import { holdBefore, RaceGate } from '../utils/race-gate';
import { SEED_USER } from '../constants/seed-users';
import { browserAgent, loginAs, type E2eApp } from '../utils/e2e-app';
import {
  applyTwoFactorEnv,
  enrolTwoFactor,
  answerSecondStep,
  totpCodeAt,
} from '../utils/auth/two-factor-enrolment';
import { storedBrowserSession } from '../utils/session/stored-browser-session';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  askCode,
  bootBrowserCodeApp,
  responseCookies,
  sessionOf,
  verifyCode,
} from './browser-code.fixtures';

describe('browser email code second factor continuation', () => {
  let e2e: E2eApp;
  let restore: () => void;
  beforeAll(async () => {
    restore = applyTwoFactorEnv();
    e2e = await bootBrowserCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
    restore();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('auth.web.signIn', {});
    await e2e.reset();
  });
  afterEach(() => jest.useRealTimers());

  it('issues a challenge instead of a session and retains email-code evidence after TOTP', async () => {
    jest.useFakeTimers({
      now: TEST_NOW,
      doNotFake: [
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    const enrolled = await loginAs(e2e.httpServer, SEED_USER);
    const setup = await enrolTwoFactor(enrolled, SEED_USER.password, TEST_NOW);
    const initialSessions = await e2e.state.sessions.countSessions();
    const browser = await browserAgent(e2e.httpServer);
    const { mail } = await askCode(e2e, browser);
    const first = await verifyCode(browser, mail.code);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      data: { requiresTwoFactor: true, user: null },
    });
    expect(
      responseCookies(first).some((cookie) => cookie.startsWith('sid=')),
    ).toBe(false);
    expect(await e2e.state.sessions.countSessions()).toBe(initialSessions);
    expect(await e2e.state.auth.countSecondFactorChallenges()).toBe(1);
    jest.setSystemTime(new Date(TEST_NOW.getTime() + 30_000));
    const completed = await answerSecondStep(browser, {
      code: totpCodeAt(setup.secret, new Date(TEST_NOW.getTime() + 30_000)),
    });
    expect(completed.status).toBe(200);
    expect(
      await storedBrowserSession(e2e.app, sessionOf(completed)),
    ).toMatchObject({
      clientId: 'web',
      authenticationMethods: ['email_code', 'totp'],
    });
    expect(await e2e.state.auth.countSecondFactorChallenges()).toBe(0);
  });
  it.each(['before-answer', 'before-issuance'])(
    'refuses a browser-code challenge when its method closes %s',
    async (phase) => {
      jest.useFakeTimers({
        now: TEST_NOW,
        doNotFake: [
          'nextTick',
          'queueMicrotask',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
        ],
      });
      const enrolled = await loginAs(e2e.httpServer, SEED_USER);
      const setup = await enrolTwoFactor(
        enrolled,
        SEED_USER.password,
        TEST_NOW,
      );
      const browser = await browserAgent(e2e.httpServer);
      const { mail } = await askCode(e2e, browser);
      expect((await verifyCode(browser, mail.code)).status).toBe(200);
      const sessions = await e2e.state.sessions.countSessions();
      jest.setSystemTime(new Date(TEST_NOW.getTime() + 30_000));
      const close = async () => {
        e2e.app.get(ConfigService).set('auth.web.signIn', { emailCode: false });
        await reconcileStartupApplications(e2e.app);
      };
      const answer = {
        code: totpCodeAt(setup.secret, new Date(TEST_NOW.getTime() + 30_000)),
      };
      const gate = new RaceGate();
      let restoreGate: () => void = () => undefined;
      if (phase === 'before-answer') await close();
      else
        restoreGate = holdBefore(
          e2e.app.get(RolePermissions),
          'ofRole',
          () => gate,
        );
      const completing = answerSecondStep(browser, answer);
      if (phase === 'before-issuance') {
        try {
          await gate.reached();
          await close();
        } finally {
          gate.release();
          restoreGate();
        }
      }
      const refused = await completing;
      expect(refused.status).toBe(401);
      expect(
        responseCookies(refused).some((cookie) => cookie.startsWith('sid=')),
      ).toBe(false);
      expect(await e2e.state.sessions.countSessions()).toBe(sessions);
    },
  );
});

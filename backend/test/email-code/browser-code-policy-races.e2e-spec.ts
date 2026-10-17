import bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { RolePermissions } from '../../src/role/stores/role-permissions';
import { ApplicationRegistry } from '../../src/session/applications/application-registry';
import { reconcileStartupApplications } from '../../src/session/session.module';
import { SEED_USER } from '../constants/seed-users';
import { browserAgent, type E2eApp } from '../utils/e2e-app';
import { holdBefore, RaceGate } from '../utils/race-gate';
import { storedBrowserSession } from '../utils/session/stored-browser-session';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  askCode,
  bootBrowserCodeApp,
  CODE_REQUEST,
  CODE_VERIFY,
  nonceOf,
  postCode,
  sessionOf,
  storedCode,
  verifyCode,
} from './browser-code.fixtures';

describe('browser email-code persisted method policy', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootBrowserCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('auth.web.signIn', {});
    await e2e.reset();
  });
  afterEach(() => jest.restoreAllMocks());

  async function closeMethod(): Promise<void> {
    e2e.app.get(ConfigService).set('auth.web.signIn', { emailCode: false });
    await reconcileStartupApplications(e2e.app);
  }

  it('versions the enforced method and refuses its older session when the method closes', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { mail } = await askCode(e2e, browser);
    const signedIn = await verifyCode(browser, mail.code);
    expect(signedIn.status).toBe(200);
    expect(
      await storedBrowserSession(e2e.app, sessionOf(signedIn)),
    ).toMatchObject({ policyVersion: 0 });
    await closeMethod();
    expect(
      await e2e.app.get(ApplicationRegistry).findByClientId('web'),
    ).toMatchObject({ policyVersion: 1, signInMethods: { emailCode: false } });
    const identity = await browser.get('/api/auth/identity');
    expect(identity.body).toMatchObject({ data: { authenticated: false } });
    const anonymous = await browserAgent(e2e.httpServer);
    expect((await anonymous.get('/api/auth/methods')).body).toMatchObject({
      data: { methods: { emailCode: false } },
    });
    expect(
      (
        await postCode(anonymous, CODE_REQUEST, {
          body: { email: SEED_USER.email },
        })
      ).status,
    ).toBe(404);
    expect(
      (await postCode(anonymous, CODE_VERIFY, { body: { code: mail.code } }))
        .status,
    ).toBe(404);
  });

  it('rechecks the stored method after the runtime guard and rolls back account creation on a stale replica', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { answer, mail } = await askCode(e2e, browser, {
      email: 'policy-race-new@example.test',
    });
    const comparison: {
      compare(value: string, hash: string): Promise<boolean>;
    } = bcrypt;
    const compare = comparison.compare.bind(comparison);
    const gate = new RaceGate();
    jest
      .spyOn(comparison, 'compare')
      .mockImplementationOnce(async (value, hash) => {
        const right = await compare(value, hash);
        await gate.hold();
        return right;
      });
    const verifying = verifyCode(browser, mail.code);
    try {
      await gate.reached();
      await closeMethod();
      e2e.app.get(ConfigService).set('auth.web.signIn', { emailCode: true });
    } finally {
      gate.release();
    }
    expect((await verifying).status).toBe(400);
    expect(
      await e2e.state.auth.countAccountsWithAddress(
        'policy-race-new@example.test',
      ),
    ).toBe(0);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expect(await e2e.state.auth.countSecondFactorChallenges()).toBe(0); // feature:totp
    expect((await storedCode(e2e, nonceOf(answer)))?.spentAt).toBeNull();
  });

  it('binds final issuance to its exact application read when policy changes later in the transaction', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { mail } = await askCode(e2e, browser);
    const gate = new RaceGate();
    const restore = holdBefore(
      e2e.app.get(RolePermissions),
      'ofRole',
      () => gate,
    );
    const verifying = verifyCode(browser, mail.code);
    try {
      await gate.reached();
      await closeMethod();
    } finally {
      gate.release();
      restore();
    }
    const result = await verifying;
    if (result.status === 200) {
      expect(
        await storedBrowserSession(e2e.app, sessionOf(result)),
      ).toMatchObject({ policyVersion: 0 });
      expect((await browser.get('/api/auth/identity')).body).toMatchObject({
        data: { authenticated: false },
      });
    } else {
      expect(result.status).toBe(400);
      expect(await e2e.state.sessions.countSessions()).toBe(0);
    }
  });
});

// feature:magic-link:start
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import { UnitOfWork } from '../../src/common/persistence/unit-of-work';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { ACCOUNT_CREATION_METHOD } from '../../src/auth/constants/account-creation';
import { SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import {
  installAccountCreationPolicy,
  type SwitchableAccountCreationPolicy,
} from '../utils/account-creation-policy';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const EMAIL = 'magic-link-creation-gate@example.test';

export function describeMagicLinkCreationGate(): void {
  describe('browser magic-link account creation policy', () => {
    let e2e: E2eApp;
    let policy: SwitchableAccountCreationPolicy;
    beforeAll(async () => {
      e2e = await bootE2eApp(0, { magicLinkEnabled: true });
    }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
    beforeEach(async () => {
      e2e.clock.set(TEST_NOW);
      await e2e.reset();
      policy = installAccountCreationPolicy(e2e.app);
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(async () => {
      await e2e?.close();
    }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

    async function ask(browser: TestAgent, email: string): Promise<string> {
      await browser
        .post('/api/auth/magic-link/request')
        .send({ email })
        .expect(200);
      const link = (await e2e.captureMail())
        .at(-1)
        ?.text?.match(/https?:\/\/[^\s]+/u)?.[0];
      const token = link ? new URL(link).searchParams.get('token') : null;
      if (!token) throw new Error('magic-link request did not mail a token');
      return token;
    }

    async function verify(browser: TestAgent, token: string) {
      const proof = await browser.get('/api/auth/browser-proof').expect(200);
      return browser
        .post('/api/auth/magic-link/verify')
        .set(
          CSRF_HEADER,
          (proof.body as { data: { token: string } }).data.token,
        )
        .send({ token });
    }

    it('creates once in a transaction for the browser application', async () => {
      const browser = await browserAgent(e2e.httpServer);
      const token = await ask(browser, EMAIL);
      expect(policy.calls).toEqual([]);

      const created = await verify(browser, token);

      expect(created.status).toBe(200);
      expect(created.body.data.user.email).toBe(EMAIL);
      expect(policy.calls).toHaveLength(1);
      expect(policy.calls[0].request).toEqual({
        application: WEB_CLIENT_ID,
        method: ACCOUNT_CREATION_METHOD.MAGIC_LINK,
      });
      expect(policy.calls[0].unitOfWork).toBeInstanceOf(UnitOfWork);
      expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(1);
      expect(await e2e.state.accounts.accountWithAddress(EMAIL)).toMatchObject({
        email: EMAIL,
        isVerified: true,
      });
    });

    it('refuses verification without storing an account or issuing a session', async () => {
      const browser = await browserAgent(e2e.httpServer);
      const token = await ask(browser, EMAIL);
      policy.refused = true;

      const refused = await verify(browser, token);

      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe(ErrorCode.ACCOUNT_CREATION_REFUSED);
      expect(policy.calls).toHaveLength(1);
      expect(await e2e.state.accounts.accountIdFor(EMAIL)).toBeNull();
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      expect((await browser.get('/api/user/profile')).status).toBe(401);
    });

    it('signs an existing account in without consulting a refusing policy', async () => {
      policy.refused = true;
      const accountId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
      const browser = await browserAgent(e2e.httpServer);
      const token = await ask(browser, SEED_USER.email);

      const signedIn = await verify(browser, token);

      expect(signedIn.status).toBe(200);
      expect(signedIn.body.data.user.id).toBe(accountId);
      expect(policy.calls).toEqual([]);
      expect(
        await e2e.state.auth.countAccountsWithAddress(SEED_USER.email),
      ).toBe(1);
    });
  });
}
// feature:magic-link:end

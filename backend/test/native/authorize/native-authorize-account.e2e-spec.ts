import { ConfigService } from '@nestjs/config';
import {
  SEED_MANAGER,
  SEED_USER,
  type SeedUser,
} from '../../constants/seed-users';
import {
  beginNativeAuthorization,
  createNativeApplication,
} from '../../utils/native/native-authorize.fixtures';
import { bootE2eApp, loginAs, type E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import { TEST_NOW } from '../../utils/frozen-clock';

const ACTIONS = ['approve', 'deny'] as const;
type Action = (typeof ACTIONS)[number];

const MALFORMED_IDS: [string, unknown][] = [
  ['a number', 7],
  ['an array', ['user']],
  ['an object', { id: 'user' }],
  ['null', null],
];

/** The callback parameter each action adds for the native app. */
const CALLBACK_PARAMETER: Record<Action, string> = {
  approve: 'code',
  deny: 'error',
};

describe('native authorize account check (e2e)', () => {
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
    e2e.app.get(ConfigService).set('auth.nativeEnabled', true);
    await createNativeApplication(e2e);
  });

  async function userId(user: SeedUser): Promise<string> {
    const found = await e2e.state.accounts.accountIdFor(user.email);
    if (found === null) throw new Error('seed user is missing');
    return found;
  }

  async function transactionState(transactionId: string) {
    const transaction =
      await e2e.state.native.authorizationRequest(transactionId);
    if (transaction === null) throw new Error('the request is missing');
    return {
      consumed: transaction.consumed,
      hasCode: transaction.codeHash !== undefined,
      hasUser: transaction.userId !== undefined,
    };
  }

  const PENDING = { consumed: false, hasCode: false, hasUser: false };

  describe.each(ACTIONS)('%s', (action) => {
    const path = `/api/oauth/authorize/${action}`;

    function expectCallback(body: unknown): void {
      const { redirectUri } = (body as { data: { redirectUri: string } }).data;
      expect(
        new URL(redirectUri).searchParams.has(CALLBACK_PARAMETER[action]),
      ).toBe(true);
    }

    it('acts for the account the page displayed', async () => {
      const browser = await loginAs(e2e.httpServer, SEED_USER);
      const started = await beginNativeAuthorization(e2e);

      const response = await browser.post(path).send({
        transactionId: started.transactionId,
        expectedUserId: await userId(SEED_USER),
      });

      expect(response.status).toBe(200);
      expectCallback(response.body);
    });

    it('refuses another account and leaves the request pending', async () => {
      const displayed = await userId(SEED_USER);
      const browser = await loginAs(e2e.httpServer, SEED_MANAGER);
      const started = await beginNativeAuthorization(e2e);

      const refused = await browser.post(path).send({
        transactionId: started.transactionId,
        expectedUserId: displayed,
      });

      expect(refused.status).toBe(409);
      expect((refused.body as { error: { code: string } }).error.code).toBe(
        'NATIVE_AUTHORIZE_ACCOUNT_MISMATCH',
      );
      expect(await transactionState(started.transactionId)).toEqual(PENDING);

      const rightAccount = await loginAs(e2e.httpServer, SEED_USER);
      const accepted = await rightAccount.post(path).send({
        transactionId: started.transactionId,
        expectedUserId: displayed,
      });
      expect(accepted.status).toBe(200);
      expectCallback(accepted.body);
    });

    it.each(MALFORMED_IDS)(
      'refuses an expected account that is %s',
      async (_label, expectedUserId) => {
        const browser = await loginAs(e2e.httpServer, SEED_USER);
        const started = await beginNativeAuthorization(e2e);

        const response = await browser.post(path).send({
          transactionId: started.transactionId,
          expectedUserId,
        });

        expect(response.status).toBe(400);
        expect((response.body as { error: { code: string } }).error.code).toBe(
          'VALIDATION_ERROR',
        );
        expect(await transactionState(started.transactionId)).toEqual(PENDING);
      },
    );

    it('refuses an empty string account as a mismatch', async () => {
      const browser = await loginAs(e2e.httpServer, SEED_USER);
      const started = await beginNativeAuthorization(e2e);

      const response = await browser.post(path).send({
        transactionId: started.transactionId,
        expectedUserId: '',
      });

      expect(response.status).toBe(409);
      expect((response.body as { error: { code: string } }).error.code).toBe(
        'NATIVE_AUTHORIZE_ACCOUNT_MISMATCH',
      );
      expect(await transactionState(started.transactionId)).toEqual(PENDING);
    });

    it('refuses an action that names no account and leaves the request pending', async () => {
      const browser = await loginAs(e2e.httpServer, SEED_USER);
      const started = await beginNativeAuthorization(e2e);

      const response = await browser
        .post(path)
        .send({ transactionId: started.transactionId });

      expect(response.status).toBe(400);
      expect((response.body as { error: { code: string } }).error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(await transactionState(started.transactionId)).toEqual(PENDING);
    });
  });
});

import { SEED_USER } from '../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { TEST_NOW } from '../utils/frozen-clock';

interface ErrorBody {
  error: { code: string };
}

/**
 * A request each signed-in two-factor route refuses for a reason of its own,
 * on an account that never set the factor up.
 */
const ROUTES: [string, Record<string, string>, number, string][] = [
  [
    '/api/auth/2fa/setup',
    { password: 'NotThePassword1!' },
    400,
    'INVALID_CURRENT_PASSWORD',
  ],
  [
    '/api/auth/2fa/confirm',
    { code: '000000' },
    400,
    'TWO_FACTOR_SETUP_REQUIRED',
  ],
  [
    '/api/auth/2fa/disable',
    { code: '000000', password: SEED_USER.password },
    400,
    'TWO_FACTOR_NOT_ENABLED',
  ],
  [
    '/api/auth/2fa/recovery-codes/regenerate',
    { code: '000000', password: SEED_USER.password },
    400,
    'TWO_FACTOR_NOT_ENABLED',
  ],
];

describe('signed-in two-factor routes are limited per client (e2e)', () => {
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
  });

  it.each(ROUTES)(
    '%s answers ten requests and refuses the eleventh',
    async (path, body, status, code) => {
      const browser = await loginAs(e2e.httpServer, SEED_USER);

      const answers: { status: number; code: string }[] = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const answer = await browser.post(path).send(body);
        answers.push({
          status: answer.status,
          code: (answer.body as ErrorBody).error.code,
        });
      }

      expect(answers.slice(0, 10)).toEqual(
        Array.from({ length: 10 }, () => ({ status, code })),
      );
      expect(answers[10]).toEqual({
        status: 429,
        code: 'RATE_LIMIT_EXCEEDED',
      });
    },
  );
});

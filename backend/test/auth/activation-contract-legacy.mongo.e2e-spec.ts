import { ConfigService } from '@nestjs/config';
import type { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import {
  mongoLegacyPendingRegistrations,
  type MongoLegacyPendingRegistrations,
} from '../utils/e2e-mongo-legacy-pending';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const CODE = '123456';
const PASSWORD = 'Password123!';
const NAME = 'Test User';
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);

// Records from before purposes existed live only in MongoDB installs.
describe('Activation contract, MongoDB legacy records (e2e)', () => {
  let e2e: E2eApp;
  let legacy: MongoLegacyPendingRegistrations;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    legacy = mongoLegacyPendingRegistrations(e2e.app);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('auth.passwordEnabled', true);
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
    body: Record<string, unknown>,
  ): Promise<Response> {
    const agent = await browserAgent(e2e.httpServer);
    return agent.post(path).send(body);
  }

  it('never honours an old-shape pending record', async () => {
    const email = 'legacy@example.test';
    await legacy.storeLegacyPendingRegistration({
      email,
      name: 'Legacy',
      hashedCode: await bcrypt.hash(CODE, 4),
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
    });

    const activated = await post('/api/auth/activate', {
      email,
      code: CODE,
      password: PASSWORD,
      name: NAME,
    });
    const confirmed = await post('/api/auth/confirm-email-change', {
      email,
      code: CODE,
    });

    expect(activated.status).toBe(400);
    expect(activated.body).toMatchObject({
      success: false,
      error: { code: ErrorCode.ACTIVATION_CODE_INVALID },
    });
    expect(confirmed.status).toBe(400);
    expect(confirmed.body).toMatchObject({
      success: false,
      error: { code: ErrorCode.ACTIVATION_CODE_INVALID },
    });
  });
});

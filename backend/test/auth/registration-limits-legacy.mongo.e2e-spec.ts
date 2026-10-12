import type { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { PENDING_PURPOSE } from '../../src/auth/constants/registration';
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
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);

// Records from before purposes existed live only in MongoDB installs.
describe('Registration limits, MongoDB legacy records (e2e)', () => {
  let e2e: E2eApp;
  let legacy: MongoLegacyPendingRegistrations;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    legacy = mongoLegacyPendingRegistrations(e2e.app);
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

  it('drops a legacy old sign-up under the old unique email index', async () => {
    const email = 'legacy-signup@example.test';
    const dropLegacyRule = await legacy.restoreLegacyAddressRule();
    await legacy.storeLegacyPendingRegistration({
      email,
      name: 'Legacy',
      hashedCode: await bcrypt.hash(CODE, 4),
      hashedPassword: 'old-hash',
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
    });

    try {
      const response = await post('/api/auth/register', { email });
      expect(response.status).toBe(200);

      const records = await legacy.pendingRegistrationsFor(email);
      expect(records).toHaveLength(1);
      expect(records[0].purpose).toBe(PENDING_PURPOSE.SIGNUP);
    } finally {
      await dropLegacyRule();
    }
  });

  it('leaves a legacy address confirmation alone and answers generically', async () => {
    const email = 'legacy-confirmation@example.test';
    const dropLegacyRule = await legacy.restoreLegacyAddressRule();
    await legacy.storeLegacyPendingRegistration({
      email,
      name: 'Legacy',
      hashedCode: await bcrypt.hash(CODE, 4),
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
    });

    try {
      const before = (await e2e.captureMail()).length;
      const response = await post('/api/auth/register', { email });

      expect(response.status).toBe(200);
      expect((await e2e.captureMail()).length - before).toBe(0);
      expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(1);
      expect(
        await e2e.state.auth.countPendingRegistrations(
          email,
          PENDING_PURPOSE.SIGNUP,
        ),
      ).toBe(0);
    } finally {
      await dropLegacyRule();
    }
  });
});

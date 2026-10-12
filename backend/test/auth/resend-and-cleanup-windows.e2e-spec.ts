import type { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { HashService } from '../../src/common/services/hash.service';
import { PENDING_PURPOSE } from '../../src/auth/constants/registration';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import type { E2ePendingRegistrationFields } from '../utils/e2e-state-auth';
import { TEST_NOW } from '../utils/frozen-clock';
import { holdStoreCall, inWindow } from '../utils/pending-race';
import { PendingRegistrationStore } from '../../src/auth/pending-codes/pending-registration.store';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const CODE = '123456';
const PASSWORD = 'Password123!';
const NAME = 'Test User';
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);
const EXPIRED_EXPIRY = new Date(TEST_NOW.getTime() - 1000);

const ACTIVATION_BODY = {
  success: false,
  error: {
    code: 'ACTIVATION_CODE_INVALID',
    message: 'Invalid or expired activation code',
  },
} as const;

describe('Resend and expired cleanup windows (e2e)', () => {
  let e2e: E2eApp;
  let hashService: HashService;
  let registrationStore: PendingRegistrationStore;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    hashService = e2e.app.get(HashService);
    registrationStore = e2e.app.get(PendingRegistrationStore);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  function pendingFields(overrides: E2ePendingRegistrationFields = {}) {
    return {
      purpose: PENDING_PURPOSE.SIGNUP,
      hashedCode: 'old-code',
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
      ...overrides,
    };
  }

  async function seedPendingRegistration(
    email: string,
    overrides: E2ePendingRegistrationFields = {},
  ): Promise<string> {
    const hashedCode = await bcrypt.hash(CODE, 4);
    await e2e.state.auth.storePendingRegistration({
      email,
      ...pendingFields({ hashedCode, ...overrides }),
    });
    return hashedCode;
  }

  async function storedRegistration(email: string) {
    const record = await e2e.state.auth.pendingRegistrationFor(email);
    if (!record) throw new Error(`expected a stored record for ${email}`);
    return record;
  }

  it('answers resend with the normal success when an activate consumes the record during the hash', async () => {
    const email = 'resend-consumed@example.test';
    await seedPendingRegistration(email);

    const response = await inWindow(
      (gate) => {
        const originalHash = hashService.hash.bind(hashService);
        const spy = jest
          .spyOn(HashService.prototype, 'hash')
          .mockImplementation(async (plain: string): Promise<string> => {
            if (/^\d{6}$/.test(plain)) await gate.hold();
            return originalHash(plain);
          });
        return () => spy.mockRestore();
      },
      () => post('/api/auth/resend-activation', { email }),
      () => e2e.state.auth.removePendingRegistration(email),
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { email } });
    expect(await e2e.captureMail()).toHaveLength(0);
    expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(0);
  });

  it('mails the refreshed code when a register replaces the record during a resend', async () => {
    const email = 'resend-replaced@example.test';
    await seedPendingRegistration(email, { expiresAt: EXPIRED_EXPIRY });

    const response = await inWindow(
      (gate) => {
        const originalHash = hashService.hash.bind(hashService);
        const spy = jest
          .spyOn(HashService.prototype, 'hash')
          .mockImplementation(async (plain: string): Promise<string> => {
            if (/^\d{6}$/.test(plain)) await gate.hold();
            return originalHash(plain);
          });
        return () => spy.mockRestore();
      },
      () => post('/api/auth/resend-activation', { email }),
      async () =>
        e2e.state.auth.replacePendingRegistrationCode(
          email,
          pendingFields({
            hashedCode: await bcrypt.hash('654321', 4),
          }),
        ),
    );

    expect(response.status).toBe(200);
    expect(await e2e.captureMail()).toHaveLength(1);
    const record = await storedRegistration(email);
    expect(record.purpose).toBe(PENDING_PURPOSE.SIGNUP);
    expect(
      await bcrypt.compare(await e2e.mailedCode(), record.hashedCode),
    ).toBe(true);
  });

  it('does not delete a replaced record when the expired cleanup runs', async () => {
    const email = 'stale-delete@example.test';
    await seedPendingRegistration(email, { expiresAt: EXPIRED_EXPIRY });

    const response = await inWindow(
      (gate) => holdStoreCall(registrationStore, 'dropExpiredRecord', gate, 0),
      () =>
        post('/api/auth/activate', {
          email,
          code: CODE,
          password: PASSWORD,
          name: NAME,
        }),
      async () =>
        e2e.state.auth.replacePendingRegistrationCode(
          email,
          pendingFields({
            hashedCode: await bcrypt.hash('654321', 4),
          }),
        ),
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject(ACTIVATION_BODY);
    expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(1);
    const record = await storedRegistration(email);
    expect(record.purpose).toBe(PENDING_PURPOSE.SIGNUP);
    expect(await bcrypt.compare('654321', record.hashedCode)).toBe(true);
  });
});

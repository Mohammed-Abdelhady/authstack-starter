import type { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import {
  MAIL_COUNTER_PURPOSE,
  PENDING_PURPOSE,
} from '../../src/auth/constants/registration';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import type { E2ePendingRegistrationFields } from '../utils/e2e-state-auth';
import { TEST_NOW } from '../utils/frozen-clock';
import { RaceGate } from '../utils/race-gate';
import { holdStoreCall, inWindow } from '../utils/pending-race';
import { PendingRegistrationStore } from '../../src/auth/pending-codes/pending-registration.store';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const CODE = '123456';
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);
const EXPIRED_EXPIRY = new Date(TEST_NOW.getTime() - 1000);

describe('Pending registration windows (e2e)', () => {
  let e2e: E2eApp;
  let registrationStore: PendingRegistrationStore;

  beforeAll(async () => {
    e2e = await bootE2eApp();
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

  it('recreates the registration when it is deleted between the live refresh and the expired replace', async () => {
    const email = 'window-replace@example.test';
    await seedPendingRegistration(email, { expiresAt: EXPIRED_EXPIRY });

    const response = await inWindow(
      (gate) => holdStoreCall(registrationStore, 'replaceExpiredCode', gate, 0),
      () => post('/api/auth/register', { email }),
      () => e2e.state.auth.removePendingRegistration(email),
    );

    expect(response.status).toBe(200);
    expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(1);
    const record = await storedRegistration(email);
    expect(record.purpose).toBe(PENDING_PURPOSE.SIGNUP);
    expect(
      await bcrypt.compare(await e2e.mailedCode(), record.hashedCode),
    ).toBe(true);
  });

  it('refreshes a record inserted between the replace and the create', async () => {
    const email = 'window-create@example.test';

    const response = await inWindow(
      (gate) => holdStoreCall(registrationStore, 'insertRecord', gate, 0),
      () => post('/api/auth/register', { email }),
      () =>
        e2e.state.auth.storePendingRegistration({
          email,
          ...pendingFields({
            hashedCode: 'inserted-code',
          }),
        }),
    );

    expect(response.status).toBe(200);
    expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(1);
    const record = await storedRegistration(email);
    expect(record.purpose).toBe(PENDING_PURPOSE.SIGNUP);
    const counter = await e2e.state.auth.mailCounterFor(
      email,
      MAIL_COUNTER_PURPOSE.SIGNUP,
    );
    expect(counter?.mailedCodes).toBe(1);
    expect(
      await bcrypt.compare(await e2e.mailedCode(), record.hashedCode),
    ).toBe(true);
  });

  it('recreates the registration when the winner is deleted after the duplicate key', async () => {
    const email = 'window-retry@example.test';
    const firstAgent = await browserAgent(e2e.httpServer);
    const secondAgent = await browserAgent(e2e.httpServer);

    const firstGate = new RaceGate();
    const secondGate = new RaceGate();
    const retryGate = new RaceGate();
    const restoreCreate = e2e.state.auth.holdPendingRegistrationInserts(
      firstGate,
      secondGate,
    );
    // The loser's second pass reaches this live refresh (the third one made)
    // after its create lost the unique index.
    const restoreQuery = holdStoreCall(
      registrationStore,
      'rotateLiveCode',
      retryGate,
      2,
    );

    try {
      const first = Promise.resolve(
        firstAgent.post('/api/auth/register').send({ email }),
      );
      await firstGate.reached(1);
      const second = Promise.resolve(
        secondAgent.post('/api/auth/register').send({ email }),
      );
      await secondGate.reached(1);

      firstGate.release();
      const firstResult = await first;
      secondGate.release();
      await retryGate.reached(1);
      await e2e.state.auth.removePendingRegistration(email);
      retryGate.release();
      const secondResult = await second;

      expect([firstResult.status, secondResult.status]).toEqual([200, 200]);
    } finally {
      restoreCreate();
      restoreQuery();
    }

    expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(1);
    const record = await storedRegistration(email);
    expect(record.purpose).toBe(PENDING_PURPOSE.SIGNUP);
    expect(
      await bcrypt.compare(await e2e.mailedCode(), record.hashedCode),
    ).toBe(true);
  });
});

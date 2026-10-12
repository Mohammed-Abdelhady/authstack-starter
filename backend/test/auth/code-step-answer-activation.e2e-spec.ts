import type { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { REQUEST_ID_HEADER } from '../../src/common/constants/request-id';
import { PENDING_PURPOSE } from '../../src/auth/constants/registration';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import type { E2ePendingRegistrationFields } from '../utils/e2e-state-auth';
import { TEST_NOW } from '../utils/frozen-clock';
import { RaceGate } from '../utils/race-gate';
import { expectSameAnswer } from '../utils/stable-answer';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const CODE = '123456';
const WRONG_CODE = '000000';
const MAX_ATTEMPTS = 5;
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

describe('Activation code step and pending registration windows (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
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

  function postWithId(
    path: string,
    body: Record<string, string>,
  ): Promise<Response> {
    return browserAgent(e2e.httpServer).then((agent) =>
      agent.post(path).set(REQUEST_ID_HEADER, 'code-step-request').send(body),
    );
  }

  async function seedPendingRegistration(
    email: string,
    overrides: E2ePendingRegistrationFields = {},
  ): Promise<string> {
    const hashedCode = await bcrypt.hash(CODE, 4);
    await e2e.state.auth.storePendingRegistration({
      email,
      purpose: PENDING_PURPOSE.SIGNUP,
      hashedCode,
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
      ...overrides,
    });
    return hashedCode;
  }

  async function storedRegistration(email: string) {
    const record = await e2e.state.auth.pendingRegistrationFor(email);
    if (!record) throw new Error(`expected a stored record for ${email}`);
    return record;
  }

  function activationBody(email: string, code: string) {
    return { email, code, password: PASSWORD, name: NAME };
  }

  /** Start two registers, release the first, then the second, so it loses. */
  async function raceCreateFirstWins(
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ): Promise<[Response, Response]> {
    const firstGate = new RaceGate();
    const secondGate = new RaceGate();
    const restore = e2e.state.auth.holdPendingRegistrationInserts(
      firstGate,
      secondGate,
    );

    try {
      const firstResponse = Promise.resolve(first());
      await firstGate.reached(1);
      const secondResponse = Promise.resolve(second());
      await secondGate.reached(1);
      firstGate.release();
      const firstResult = await firstResponse;
      secondGate.release();
      const secondResult = await secondResponse;
      return [firstResult, secondResult];
    } finally {
      restore();
    }
  }

  it('answers every failing activation code the same way', async () => {
    const noPending = await postWithId(
      '/api/auth/activate',
      activationBody('activate-none@example.test', WRONG_CODE),
    );

    await seedPendingRegistration('activate-wrong@example.test');
    const wrong = await postWithId(
      '/api/auth/activate',
      activationBody('activate-wrong@example.test', WRONG_CODE),
    );

    await seedPendingRegistration('activate-expired@example.test', {
      expiresAt: EXPIRED_EXPIRY,
    });
    const expired = await postWithId(
      '/api/auth/activate',
      activationBody('activate-expired@example.test', CODE),
    );

    await seedPendingRegistration('activate-locked@example.test', {
      attempts: MAX_ATTEMPTS,
    });
    const locked = await postWithId(
      '/api/auth/activate',
      activationBody('activate-locked@example.test', CODE),
    );

    expectSameAnswer(wrong, noPending);
    expectSameAnswer(expired, noPending);
    expectSameAnswer(locked, noPending);

    expect(noPending.status).toBe(400);
    expect(noPending.body).toEqual({
      ...ACTIVATION_BODY,
      requestId: 'code-step-request',
    });
  });

  it('still refuses the right activation code after the attempt limit, and stores why', async () => {
    const email = 'activate-limit@example.test';
    const hashedCode = await seedPendingRegistration(email);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await post('/api/auth/activate', activationBody(email, WRONG_CODE));
    }

    const refused = await post(
      '/api/auth/activate',
      activationBody(email, CODE),
    );
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject(ACTIVATION_BODY);

    const record = await storedRegistration(email);
    expect(record.attempts).toBe(MAX_ATTEMPTS);
    expect(record.hashedCode).toBe(hashedCode);
  });

  it('keeps one credential-free record when two registers race', async () => {
    const email = 'register-race@example.test';
    const firstAgent = await browserAgent(e2e.httpServer);
    const secondAgent = await browserAgent(e2e.httpServer);

    const [first, second] = await raceCreateFirstWins(
      () => firstAgent.post('/api/auth/register').send({ email }),
      () => secondAgent.post('/api/auth/register').send({ email }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(1);

    const record = await storedRegistration(email);
    expect(record.purpose).toBe(PENDING_PURPOSE.SIGNUP);
    expect(
      await bcrypt.compare(await e2e.mailedCode(), record.hashedCode),
    ).toBe(true);
    const raw = await e2e.state.auth.storedPendingRegistrationFields(email);
    expect(raw).not.toHaveProperty('hashedPassword');
    expect(raw).not.toHaveProperty('name');
  });
});

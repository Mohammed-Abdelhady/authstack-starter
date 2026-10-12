import type { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { REQUEST_ID_HEADER } from '../../src/common/constants/request-id';
import { SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent,
  loginAs,
  type E2eApp,
} from '../utils/e2e-app';
import type { E2ePendingPasswordResetCode } from '../utils/e2e-state-auth';
import { TEST_NOW } from '../utils/frozen-clock';
import { RaceGate } from '../utils/race-gate';
import { expectSameAnswer } from '../utils/stable-answer';
import { holdStoreCall, inWindow } from '../utils/pending-race';
import { PasswordResetCodeStore } from '../../src/auth/pending-codes/password-reset-code.store';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const PASSWORD = 'Password123!';
const CODE = '123456';
const WRONG_CODE = '000000';
const MAX_ATTEMPTS = 5;
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);
const EXPIRED_EXPIRY = new Date(TEST_NOW.getTime() - 1000);

const RESET_BODY = {
  success: false,
  error: {
    code: 'PASSWORD_RESET_CODE_INVALID',
    message: 'Invalid or expired password reset code',
  },
} as const;

describe('Password reset code step and pending reset windows (e2e)', () => {
  let e2e: E2eApp;
  let resetStore: PasswordResetCodeStore;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    resetStore = e2e.app.get(PasswordResetCodeStore);
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

  async function seedPendingPasswordReset(
    email: string,
    overrides: Partial<E2ePendingPasswordResetCode> = {},
  ): Promise<void> {
    await e2e.state.auth.storePendingPasswordReset({
      email,
      hashedCode: await bcrypt.hash(CODE, 4),
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
      ...overrides,
    });
  }

  async function storedReset(email: string) {
    const record = await e2e.state.auth.pendingPasswordResetFor(email);
    if (!record) throw new Error(`expected a stored record for ${email}`);
    return record;
  }

  function createVerifiedAccount(email: string): Promise<unknown> {
    return e2e.state.accounts.createAccount({
      email,
      name: 'Existing Account',
      isVerified: true,
    });
  }

  /** Start two forgot-password writes, release the first, then the second. */
  async function raceCreateFirstWins(
    first: () => Promise<Response>,
    second: () => Promise<Response>,
  ): Promise<[Response, Response]> {
    const firstGate = new RaceGate();
    const secondGate = new RaceGate();
    const restore = e2e.state.auth.holdPendingPasswordResetInserts(
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

  it('answers every failing password reset code the same way', async () => {
    const noPending = await postWithId('/api/auth/reset-password', {
      email: 'reset-none@example.test',
      code: WRONG_CODE,
      newPassword: PASSWORD,
    });

    await seedPendingPasswordReset('reset-wrong@example.test');
    const wrong = await postWithId('/api/auth/reset-password', {
      email: 'reset-wrong@example.test',
      code: WRONG_CODE,
      newPassword: PASSWORD,
    });

    await seedPendingPasswordReset('reset-expired@example.test', {
      expiresAt: EXPIRED_EXPIRY,
    });
    const expired = await postWithId('/api/auth/reset-password', {
      email: 'reset-expired@example.test',
      code: CODE,
      newPassword: PASSWORD,
    });

    await seedPendingPasswordReset('reset-locked@example.test', {
      attempts: MAX_ATTEMPTS,
    });
    const locked = await postWithId('/api/auth/reset-password', {
      email: 'reset-locked@example.test',
      code: CODE,
      newPassword: PASSWORD,
    });

    expectSameAnswer(wrong, noPending);
    expectSameAnswer(expired, noPending);
    expectSameAnswer(locked, noPending);

    expect(noPending.status).toBe(400);
    expect(noPending.body).toEqual({
      ...RESET_BODY,
      requestId: 'code-step-request',
    });
  });

  it('still refuses the right password reset code after the attempt limit, and stores why', async () => {
    const email = 'reset-limit@example.test';
    await seedPendingPasswordReset(email);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await post('/api/auth/reset-password', {
        email,
        code: WRONG_CODE,
        newPassword: PASSWORD,
      });
    }

    const refused = await post('/api/auth/reset-password', {
      email,
      code: CODE,
      newPassword: PASSWORD,
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject(RESET_BODY);

    const record = await storedReset(email);
    expect(record.attempts).toBe(MAX_ATTEMPTS);
  });

  it('answers two forgot-password requests at once for a known address with one record', async () => {
    const email = 'forgot-race@example.test';
    await createVerifiedAccount(email);
    const firstAgent = await browserAgent(e2e.httpServer);
    const secondAgent = await browserAgent(e2e.httpServer);

    const [first, second] = await raceCreateFirstWins(
      () => firstAgent.post('/api/auth/forgot-password').send({ email }),
      () => secondAgent.post('/api/auth/forgot-password').send({ email }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(second.body);
    expect(await e2e.state.auth.countPendingPasswordResets(email)).toBe(1);

    const record = await storedReset(email);
    // The loser updated the code last, so the last mail is the live code.
    expect(
      await bcrypt.compare(await e2e.mailedCode(), record.hashedCode),
    ).toBe(true);
  });

  it('updates a record inserted between the update and the create', async () => {
    const email = 'reset-window-create@example.test';
    await createVerifiedAccount(email);

    const response = await inWindow(
      (gate) => holdStoreCall(resetStore, 'insertRecord', gate, 0),
      () => post('/api/auth/forgot-password', { email }),
      async () =>
        e2e.state.auth.storePendingPasswordReset({
          email,
          hashedCode: await bcrypt.hash('654321', 4),
          attempts: 0,
          expiresAt: LIVE_EXPIRY,
        }),
    );

    expect(response.status).toBe(200);
    expect(await e2e.state.auth.countPendingPasswordResets(email)).toBe(1);
    const record = await storedReset(email);
    expect(
      await bcrypt.compare(await e2e.mailedCode(), record.hashedCode),
    ).toBe(true);
  });

  it('recreates the reset when the winner is deleted after the duplicate key', async () => {
    const email = 'reset-window-retry@example.test';
    await createVerifiedAccount(email);
    const firstAgent = await browserAgent(e2e.httpServer);
    const secondAgent = await browserAgent(e2e.httpServer);

    const firstGate = new RaceGate();
    const secondGate = new RaceGate();
    const retryGate = new RaceGate();
    const restoreCreate = e2e.state.auth.holdPendingPasswordResetInserts(
      firstGate,
      secondGate,
    );
    // Both first updates ran before the creates; the loser's second pass
    // reaches update call 2 after its create lost the unique index.
    const restoreQuery = holdStoreCall(resetStore, 'rotateCode', retryGate, 2);

    let firstResult: Response;
    let secondResult: Response;
    try {
      const first = Promise.resolve(
        firstAgent.post('/api/auth/forgot-password').send({ email }),
      );
      await firstGate.reached(1);
      const second = Promise.resolve(
        secondAgent.post('/api/auth/forgot-password').send({ email }),
      );
      await secondGate.reached(1);

      firstGate.release();
      firstResult = await first;
      secondGate.release();
      await retryGate.reached(1);
      await e2e.state.auth.removePendingPasswordReset(email);
      retryGate.release();
      secondResult = await second;

      expect([firstResult.status, secondResult.status]).toEqual([200, 200]);
    } finally {
      restoreCreate();
      restoreQuery();
    }

    expect(await e2e.state.auth.countPendingPasswordResets(email)).toBe(1);
    const record = await storedReset(email);
    expect(
      await bcrypt.compare(await e2e.mailedCode(), record.hashedCode),
    ).toBe(true);
  });

  it('does not delete a replaced reset when the expired cleanup runs', async () => {
    const email = 'reset-stale-delete@example.test';
    await seedPendingPasswordReset(email, { expiresAt: EXPIRED_EXPIRY });

    const response = await inWindow(
      (gate) => holdStoreCall(resetStore, 'dropExpiredRecord', gate, 0),
      () =>
        post('/api/auth/reset-password', {
          email,
          code: CODE,
          newPassword: PASSWORD,
        }),
      async () =>
        e2e.state.auth.replacePendingPasswordResetCode(email, {
          hashedCode: await bcrypt.hash('654321', 4),
          attempts: 0,
          expiresAt: LIVE_EXPIRY,
        }),
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject(RESET_BODY);
    expect(await e2e.state.auth.countPendingPasswordResets(email)).toBe(1);
    const record = await storedReset(email);
    expect(await bcrypt.compare('654321', record.hashedCode)).toBe(true);
  });

  it('refuses a newly mailed code for a locked address and still signs that account in by password', async () => {
    const email = SEED_USER.email;
    await seedPendingPasswordReset(email);
    for (let guess = 0; guess < MAX_ATTEMPTS; guess += 1) {
      await post('/api/auth/reset-password', {
        email,
        code: WRONG_CODE,
        newPassword: PASSWORD,
      });
    }
    await post('/api/auth/forgot-password', { email });

    const locked = await post('/api/auth/reset-password', {
      email,
      code: await e2e.mailedCode(),
      newPassword: PASSWORD,
    });
    const signedIn = await loginAs(e2e.httpServer, SEED_USER);
    const account = await signedIn.get('/api/user/profile');

    expect(locked.status).toBe(400);
    expect(locked.body).toMatchObject(RESET_BODY);
    expect(account.status).toBe(200);
  });
});

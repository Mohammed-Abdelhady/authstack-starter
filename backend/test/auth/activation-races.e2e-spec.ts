import type { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { HashService } from '../../src/common/services/hash.service';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { PENDING_PURPOSE } from '../../src/auth/constants/registration';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import { RaceGate } from '../utils/race-gate';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const CODE = '123456';
const PASSWORD = 'Password123!';
const NAME = 'Test User';
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);

describe('Activation races and collisions (e2e)', () => {
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

  function activationBody(
    email: string,
    code: string,
    password: string,
  ): Record<string, string> {
    return { email, code, password, name: NAME };
  }

  async function signInStatus(
    email: string,
    password: string,
  ): Promise<number> {
    return (await post('/api/auth/login', { email, password })).status;
  }

  it('gates two activations at the consume and lets only one win', async () => {
    const email = 'race-activate@example.test';
    const firstPassword = 'FirstPass-1';
    const secondPassword = 'SecondPass-2';
    await post('/api/auth/register', { email });
    await post('/api/auth/register', { email });
    const code = await e2e.mailedCode();

    const gate = new RaceGate();
    const restore = e2e.state.auth.holdPendingRegistrationConsumes(gate, 2);

    let first: Response;
    let second: Response;
    try {
      const firstRequest = Promise.resolve(
        post('/api/auth/activate', activationBody(email, code, firstPassword)),
      );
      const secondRequest = Promise.resolve(
        post('/api/auth/activate', activationBody(email, code, secondPassword)),
      );
      await gate.reached(2);
      gate.release();
      [first, second] = await Promise.all([firstRequest, secondRequest]);
    } finally {
      restore();
    }

    expect([first.status, second.status].sort()).toEqual([200, 400]);
    expect(await e2e.state.auth.countAccountsWithAddress(email)).toBe(1);

    const signIn = [
      await signInStatus(email, firstPassword),
      await signInStatus(email, secondPassword),
    ];
    expect(signIn.sort()).toEqual([200, 401]);
  });

  it('refuses an activation whose code was refreshed during the password hash', async () => {
    const email = 'hash-race@example.test';
    await post('/api/auth/register', { email });
    const code = await e2e.mailedCode();

    const gate = new RaceGate();
    const hashService = e2e.app.get(HashService);
    const originalHash = hashService.hash.bind(hashService);
    const spy = jest
      .spyOn(hashService, 'hash')
      .mockImplementation(async (plain: string): Promise<string> => {
        if (plain === PASSWORD) {
          await gate.hold();
        }
        return originalHash(plain);
      });

    try {
      const activation = Promise.resolve(
        post('/api/auth/activate', activationBody(email, code, PASSWORD)),
      );
      await gate.reached(1);
      // A new registration refreshes the code while the password is hashed.
      await post('/api/auth/register', { email });
      gate.release();

      const response = await activation;
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: ErrorCode.ACTIVATION_CODE_INVALID },
      });
    } finally {
      spy.mockRestore();
    }

    expect(await e2e.state.auth.countAccountsWithAddress(email)).toBe(0);
  });

  it('lets an account created meanwhile win the collision, unchanged', async () => {
    const email = 'collision@example.test';
    await post('/api/auth/register', { email });
    const code = await e2e.mailedCode();

    const gate = new RaceGate();
    const hashService = e2e.app.get(HashService);
    const originalHash = hashService.hash.bind(hashService);
    const spy = jest
      .spyOn(hashService, 'hash')
      .mockImplementation(async (plain: string): Promise<string> => {
        if (plain === PASSWORD) {
          await gate.hold();
        }
        return originalHash(plain);
      });

    try {
      const activation = Promise.resolve(
        post('/api/auth/activate', activationBody(email, code, PASSWORD)),
      );
      await gate.reached(1);
      const winner = await e2e.state.accounts.createAccount({
        email,
        name: 'Other Sign-In',
        isVerified: true,
      });
      gate.release();

      const response = await activation;
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: ErrorCode.ACTIVATION_CODE_INVALID },
      });

      const stored = await e2e.state.accounts.accountWithAddress(email);
      expect(stored?.name).toBe('Other Sign-In');
      expect(stored?._id.toString()).toBe(winner._id.toString());
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses a stale address change end to end', async () => {
    const email = 'stale-change@example.test';
    const target = await e2e.state.accounts.createAccount({
      email,
      name: 'Target',
      isVerified: false,
      addressGeneration: 4,
    });
    await e2e.state.auth.storePendingRegistration({
      email,
      purpose: PENDING_PURPOSE.EMAIL_CHANGE,
      hashedCode: await bcrypt.hash(CODE, 4),
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
      userId: target._id,
      addressGeneration: 3,
    });

    const response = await post('/api/auth/confirm-email-change', {
      email,
      code: CODE,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: ErrorCode.ACTIVATION_CODE_INVALID },
    });
    expect(
      (await e2e.state.accounts.accountWithId(target._id))?.isVerified,
    ).toBe(false);
  });
});

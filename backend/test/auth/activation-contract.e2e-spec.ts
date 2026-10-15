import { activationApplicationCases } from '../utils/auth/activation-application-cases';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { PENDING_PURPOSE } from '../../src/auth/constants/registration';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import type { E2ePendingRegistrationFields } from '../utils/e2e-state-auth';
import { TEST_NOW } from '../utils/frozen-clock';
import { describePasswordCreationGate } from './account-creation-gate.harness-spec';
import { seedPendingEmailChange } from '../utils/auth/pending-email-change-seed';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const CODE = '123456';
const PASSWORD = 'Password123!';
const NAME = 'Test User';
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);
const TOO_LONG_PASSWORD = `A1${'a'.repeat(71)}`;

describePasswordCreationGate();

describe('Activation contract (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
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

  function pendingFields(overrides: E2ePendingRegistrationFields = {}) {
    return {
      purpose: PENDING_PURPOSE.SIGNUP,
      hashedCode: 'old-code',
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
      ...overrides,
    };
  }

  async function seedSignup(
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

  it('refuses an old-shape registration the same way for a free and a taken address', async () => {
    const takenEmail = 'old-taken@example.test';
    await e2e.state.accounts.createAccount({
      email: takenEmail,
      name: 'Taken',
      isVerified: true,
    });

    const free = await post('/api/auth/register', {
      email: 'old-free@example.test',
      password: PASSWORD,
      name: NAME,
    });
    const taken = await post('/api/auth/register', {
      email: takenEmail,
      password: PASSWORD,
      name: NAME,
    });

    expect(taken.status).toBe(free.status);
    expect(taken.body.error).toEqual(free.body.error);
    expect(free.status).toBe(400);
    expect(free.body).toMatchObject({
      success: false,
      error: { code: ErrorCode.REGISTRATION_CONTRACT_OUTDATED },
    });
  });

  it.each([
    {
      label: 'over-long password',
      body: { code: CODE, password: TOO_LONG_PASSWORD, name: NAME },
    },
    {
      label: 'weak password',
      body: { code: CODE, password: 'short', name: NAME },
    },
    {
      label: 'empty name',
      body: { code: CODE, password: PASSWORD, name: '' },
    },
    {
      label: 'malformed code',
      body: { code: 'abc', password: PASSWORD, name: NAME },
    },
    {
      label: 'missing password',
      body: { code: CODE, name: NAME },
    },
    {
      label: 'null password',
      body: { code: CODE, password: null, name: NAME },
    },
    {
      label: 'null code',
      body: { code: null, password: PASSWORD, name: NAME },
    },
  ])(
    'answers invalid activation fields the same for every address state: $label',
    async ({ body }) => {
      const email = 'validate@example.test';
      await seedSignup(email);
      const seeded = await post('/api/auth/activate', { email, ...body });
      const unknown = await post('/api/auth/activate', {
        email: 'none@example.test',
        ...body,
      });

      expect(unknown.status).toBe(seeded.status);
      expect(unknown.body.error).toEqual(seeded.body.error);
      expect(seeded.status).toBe(400);
      expect(seeded.body).toMatchObject({
        success: false,
        error: { code: ErrorCode.VALIDATION_ERROR },
      });

      const record = await e2e.state.auth.pendingRegistrationFor(email);
      expect(record?.attempts).toBe(0);
    },
  );

  it('does not let a sign-up code confirm an address change or the reverse', async () => {
    const signupEmail = 'cross-signup@example.test';
    await seedSignup(signupEmail);
    const asConfirm = await post('/api/auth/confirm-email-change', {
      email: signupEmail,
      code: CODE,
    });
    expect(asConfirm.status).toBe(400);
    expect(asConfirm.body).toMatchObject({
      success: false,
      error: { code: ErrorCode.ACTIVATION_CODE_INVALID },
    });

    const changeEmail = 'cross-change@example.test';
    await seedPendingEmailChange(e2e, {
      email: changeEmail,
      code: CODE,
      expiresAt: LIVE_EXPIRY,
      addressGeneration: 1,
    });
    const asActivate = await post('/api/auth/activate', {
      email: changeEmail,
      code: CODE,
      password: PASSWORD,
      name: NAME,
    });
    expect(asActivate.status).toBe(400);
    expect(asActivate.body).toMatchObject({
      success: false,
      error: { code: ErrorCode.ACTIVATION_CODE_INVALID },
    });
  });

  it('confirms an address change without a session, with password sign-in disabled', async () => {
    const email = 'moved@example.test';
    const target = await seedPendingEmailChange(e2e, {
      email,
      code: CODE,
      expiresAt: LIVE_EXPIRY,
      addressGeneration: 3,
    });
    e2e.app.get(ConfigService).set('auth.passwordEnabled', false);

    const response = await post('/api/auth/confirm-email-change', {
      email,
      code: CODE,
    });

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    const stored = await e2e.state.accounts.accountWithId(target._id);
    expect(stored?.isVerified).toBe(true);
    expect(stored).toMatchObject({
      email,
      isVerified: true,
      addressGeneration: 3,
    });
    expect(stored?.pendingEmail).toBeUndefined();
  });

  it('leaves the code usable when the account write fails before the commit', async () => {
    const email = 'write-fails@example.test';
    await post('/api/auth/register', { email });
    const code = await e2e.mailedCode();
    const restoreWrite = e2e.state.auth.failNextAccountWrite();

    const failed = await post('/api/auth/activate', {
      email,
      code,
      password: PASSWORD,
      name: NAME,
    });
    expect(failed.status).toBe(500);
    restoreWrite();

    const retried = await post('/api/auth/activate', {
      email,
      code,
      password: PASSWORD,
      name: NAME,
    });
    expect(retried.status).toBe(200);
    expect(await e2e.state.auth.countAccountsWithAddress(email)).toBe(1);
  });

  it('issues no session cookie when the role read fails after the commit', async () => {
    const email = 'role-read-fails@example.test';
    await post('/api/auth/register', { email });
    const code = await e2e.mailedCode();
    const restoreRoleRead = e2e.state.auth.failNextRoleRead();

    const response = await post('/api/auth/activate', {
      email,
      code,
      password: PASSWORD,
      name: NAME,
    });
    restoreRoleRead();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { requiresTwoFactor: false, mustSignIn: true, user: null },
    });
    expect(response.headers['set-cookie']).toBeUndefined();

    const stored = await e2e.state.accounts.accountWithAddress(email);
    expect(stored?.isVerified).toBe(true);
    expect(await bcrypt.compare(PASSWORD, stored?.password ?? '')).toBe(true);
  });
});

activationApplicationCases();

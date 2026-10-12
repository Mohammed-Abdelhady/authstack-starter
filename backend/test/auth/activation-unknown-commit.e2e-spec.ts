import { Logger } from '@nestjs/common';
import type { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { PENDING_PURPOSE } from '../../src/auth/constants/registration';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import type { E2eRestore } from '../utils/e2e-state-auth';
import { TEST_NOW } from '../utils/frozen-clock';
import { RaceGate } from '../utils/race-gate';
import { seedPendingEmailChange } from '../utils/auth/pending-email-change-seed';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const CODE = '123456';
const PASSWORD = 'Password123!';
const NAME = 'Test User';
const LIVE_EXPIRY = new Date(TEST_NOW.getTime() + 15 * 60 * 1000);

/**
 * The driver's commit result is unknown to the server: it may have landed or
 * not. These cases force that boundary and check what the server answers.
 */
describe('Activation unknown commit outcomes (e2e)', () => {
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

  function expectUnknownOutcome(response: Response): void {
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe(
      ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
    );
  }

  function activationBody(
    email: string,
    code: string,
    password: string,
  ): Record<string, string> {
    return { email, code, password, name: NAME };
  }

  async function seedSignup(email: string): Promise<void> {
    await e2e.state.auth.storePendingRegistration({
      email,
      purpose: PENDING_PURPOSE.SIGNUP,
      hashedCode: await bcrypt.hash(CODE, 4),
      attempts: 0,
      expiresAt: LIVE_EXPIRY,
    });
  }

  async function seedEmailChange(email: string, generation: number) {
    return seedPendingEmailChange(e2e, {
      email,
      code: CODE,
      expiresAt: LIVE_EXPIRY,
      addressGeneration: generation,
    });
  }

  /** Inject an ambiguous commit answer, optionally after the actual commit. */
  function unknownCommit(
    lands: boolean,
    unlabelledNetworkError = false,
  ): E2eRestore {
    return e2e.state.auth.makeCommitOutcomesUnknown({
      lands,
      bareNetworkError: unlabelledNetworkError,
    });
  }

  it('answers sign-in-required when the unknown commit did land', async () => {
    const email = 'unknown-commit-landed@example.test';
    await seedSignup(email);
    const restore = unknownCommit(true);
    const response = await post(
      '/api/auth/activate',
      activationBody(email, CODE, PASSWORD),
    );
    restore();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { requiresTwoFactor: false, mustSignIn: true, user: null },
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    const stored = await e2e.state.accounts.accountWithAddress(email);
    expect(await bcrypt.compare(PASSWORD, stored?.password ?? '')).toBe(true);
    expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(0);
  });

  it('does not answer sign-in-required when the commit did not land and a foreign account exists', async () => {
    const email = 'unknown-commit-foreign@example.test';
    await seedSignup(email);
    const gate = new RaceGate();
    // The commit releases the transaction's write locks, then lets the test
    // insert a foreign account for the same address before it reports its
    // unknown result. The transaction never lands.
    const restore = e2e.state.auth.abandonCommitsThenGoSilent(gate);

    let response: Response;
    try {
      const activation = Promise.resolve(
        post('/api/auth/activate', activationBody(email, CODE, PASSWORD)),
      );
      await gate.reached(1);
      await e2e.state.accounts.createAccount({
        email,
        name: 'Foreign',
        isVerified: true,
      });
      gate.release();
      response = await activation;
    } finally {
      restore();
    }

    expectUnknownOutcome(response);
    expect(response.body).not.toMatchObject({ data: { mustSignIn: true } });
    expect((await e2e.state.accounts.accountWithAddress(email))?.name).toBe(
      'Foreign',
    );
  });

  it('answers sign-in-required when an unlabelled network error follows a landed activation', async () => {
    const email = 'network-commit-landed@example.test';
    await seedSignup(email);
    const restore = unknownCommit(true, true);

    const response = await post(
      '/api/auth/activate',
      activationBody(email, CODE, PASSWORD),
    );
    restore();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { requiresTwoFactor: false, mustSignIn: true, user: null },
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await e2e.state.auth.countAccountsWithAddress(email)).toBe(1);
  });

  it('answers unknown when an unlabelled network error follows an activation that did not land', async () => {
    const email = 'network-commit-lost@example.test';
    await seedSignup(email);
    const read = e2e.state.auth.watchAccountLookupsAfterCommit();
    const restore = unknownCommit(false, true);
    const response = await post(
      '/api/auth/activate',
      activationBody(email, CODE, PASSWORD),
    );
    restore();

    expectUnknownOutcome(response);
    expect(response.body).not.toMatchObject({ data: { mustSignIn: true } });
    expect(await e2e.state.auth.countAccountsWithAddress(email)).toBe(0);
    expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('leaves the pending record usable when the commit did not land', async () => {
    const email = 'commit-lost@example.test';
    await seedSignup(email);
    const restore = unknownCommit(false);
    const first = await post(
      '/api/auth/activate',
      activationBody(email, CODE, PASSWORD),
    );
    restore();

    expectUnknownOutcome(first);
    expect(await e2e.state.auth.countAccountsWithAddress(email)).toBe(0);
    expect(await e2e.state.auth.countPendingRegistrations(email)).toBe(1);

    // The code was never consumed, so a normal activation still works.
    const second = await post(
      '/api/auth/activate',
      activationBody(email, CODE, PASSWORD),
    );
    expect(second.status).toBe(200);
  });

  it('answers unknown when the unknown-commit re-read fails', async () => {
    const email = 'commit-read-fail@example.test';
    await seedSignup(email);
    const restoreCommit = unknownCommit(false);
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const restoreRead = e2e.state.auth.failNextAccountLookupAfterCommit();

    const response = await post(
      '/api/auth/activate',
      activationBody(email, CODE, PASSWORD),
    );
    restoreRead();
    restoreCommit();

    expectUnknownOutcome(response);
    const logged = errorSpy.mock.calls
      .map((call: unknown[]) => call.map((v) => String(v)).join(' '))
      .join('\n');
    expect(logged).toContain('cause=name=Error');
    expect(logged).not.toContain('cause=name=TypeError');
    errorSpy.mockRestore();
  });

  it('confirms the change when the unknown email-change commit did land', async () => {
    const email = 'change-commit-landed@example.test';
    const target = await seedEmailChange(email, 4);
    const restore = unknownCommit(true);

    const response = await post('/api/auth/confirm-email-change', {
      email,
      code: CODE,
    });
    restore();

    expect(response.status).toBe(200);
    expect(
      (await e2e.state.accounts.accountWithId(target._id))?.isVerified,
    ).toBe(true);
    expect(await e2e.state.accounts.accountWithAddress(email)).toMatchObject({
      _id: target._id,
      email,
      isVerified: true,
      pendingEmail: undefined,
    });
  });

  it('answers unknown when the email-change commit did not land', async () => {
    const email = 'change-commit-lost@example.test';
    const target = await seedEmailChange(email, 4);
    const restore = unknownCommit(false);

    const response = await post('/api/auth/confirm-email-change', {
      email,
      code: CODE,
    });
    restore();

    expectUnknownOutcome(response);
    expect(
      (await e2e.state.accounts.accountWithId(target._id))?.isVerified,
    ).toBe(true);
    expect(await e2e.state.accounts.accountWithId(target._id)).toMatchObject({
      _id: target._id,
      email: target.previousEmail,
      isVerified: true,
      pendingEmail: email,
      addressGeneration: 4,
    });
  });

  it('confirms the change when an unlabelled network error follows a landed commit', async () => {
    const email = 'network-change-landed@example.test';
    const target = await seedEmailChange(email, 4);
    const restore = unknownCommit(true, true);

    const response = await post('/api/auth/confirm-email-change', {
      email,
      code: CODE,
    });
    restore();

    expect(response.status).toBe(200);
    expect(
      (await e2e.state.accounts.accountWithId(target._id))?.isVerified,
    ).toBe(true);
    expect(await e2e.state.accounts.accountWithAddress(email)).toMatchObject({
      _id: target._id,
      email,
      isVerified: true,
      pendingEmail: undefined,
    });
  });

  it('does not confirm the change when an unlabelled network error follows a commit that did not land', async () => {
    const email = 'network-change-lost@example.test';
    const target = await seedEmailChange(email, 4);
    const read = e2e.state.auth.watchAccountLookupsAfterCommit();
    const restore = unknownCommit(false, true);

    const response = await post('/api/auth/confirm-email-change', {
      email,
      code: CODE,
    });
    restore();

    expectUnknownOutcome(response);
    const outcomeReads = read.mock.calls.filter(
      (call: unknown) => Array.isArray(call) && typeof call[0] === 'string',
    );
    expect(outcomeReads).toEqual([[target._id]]);
    expect(
      (await e2e.state.accounts.accountWithId(target._id))?.isVerified,
    ).toBe(true);
    expect(await e2e.state.accounts.accountWithId(target._id)).toMatchObject({
      _id: target._id,
      email: target.previousEmail,
      isVerified: true,
      pendingEmail: email,
      addressGeneration: 4,
    });
  });
});

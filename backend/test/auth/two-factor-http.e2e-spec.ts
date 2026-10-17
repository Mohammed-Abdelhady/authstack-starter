// feature:email-password:start
import {
  cookieNames,
  expectSecondFactorEvidence,
} from '../utils/auth/second-factor-evidence';
// feature:email-password:end
import { twoFactorApplicationCases } from '../utils/auth/two-factor-application-cases'; // feature:email-password
import type { Response } from 'supertest'; // feature:email-password
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service'; // feature:email-password
import { TWO_FACTOR_CHALLENGE_COOKIE } from '../../src/auth/two-factor/constants/two-factor.constants'; // feature:email-password
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_USER } from '../constants/seed-users';
import {
  answerSecondStep, // feature:email-password
  applyTwoFactorEnv,
  enrolTwoFactor,
  passwordFirstStep, // feature:email-password
  totpCodeAt,
  type Enrolment,
} from '../utils/auth/two-factor-enrolment';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

/** Three authenticator steps, 30 seconds apart: a spent step is never reused. */
const STEP_ONE = new Date('2099-01-01T12:00:00.000Z');
const STEP_TWO = new Date('2099-01-01T12:00:30.000Z'); // feature:email-password
const STEP_THREE = new Date('2099-01-01T12:01:00.000Z'); // feature:email-password

/** Everything but the calendar keeps running, so requests and the database do. */
const ONLY_THE_CALENDAR = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

interface ErrorBody {
  success: boolean;
  error: { code: string };
}

// feature:email-password:start
interface SignedInBody {
  data: { requiresTwoFactor: boolean; user: { email: string } | null };
}

// feature:email-password:end

describe('two-step sign-in over HTTP (e2e)', () => {
  let e2e: E2eApp;
  let restoreEnv: () => void;
  let sessionCookie: string; // feature:email-password

  beforeAll(async () => {
    restoreEnv = applyTwoFactorEnv();
    e2e = await bootE2eApp();
    sessionCookie = e2e.app.get(SessionCookieService, { strict: false }).name; // feature:email-password
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
    restoreEnv();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    jest.useFakeTimers({ now: STEP_ONE, doNotFake: [...ONLY_THE_CALENDAR] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Two-step on for the seeded user; the confirming code spent step one. */
  async function enrolled(): Promise<{ owner: TestAgent } & Enrolment> {
    const owner = await loginAs(e2e.httpServer, SEED_USER);
    const enrolment = await enrolTwoFactor(owner, SEED_USER.password, STEP_ONE);
    return { owner, ...enrolment };
  }

  twoFactorApplicationCases(() => e2e, enrolled); // feature:email-password

  // feature:email-password:start
  async function expectSignedIn(agent: TestAgent, answered: Response) {
    expect(answered.status).toBe(200);
    expect((answered.body as SignedInBody).data).toMatchObject({
      requiresTwoFactor: false,
      user: { email: SEED_USER.email },
    });
    expect(cookieNames(answered)).toEqual([sessionCookie]);
    const profile = await agent.get('/api/user/profile').expect(200);
    expect(profile.body).toMatchObject({
      data: { email: SEED_USER.email, twoFactorEnabled: true },
    });
  }

  async function expectCodeRefused(agent: TestAgent, answered: Response) {
    expect(answered.status).toBe(401);
    expect((answered.body as ErrorBody).error.code).toBe(
      ErrorCode.TWO_FACTOR_CODE_INVALID,
    );
    expect(cookieNames(answered)).toEqual([]);
    await agent.get('/api/user/profile').expect(401);
  }

  // feature:email-password:end

  describe('turning it on', () => {
    it('hands a signed-in account a secret, then ten recovery codes for its first code', async () => {
      const { owner, secret, otpauthUrl, recoveryCodes } = await enrolled();

      const url = new URL(otpauthUrl);
      expect(url.protocol).toBe('otpauth:');
      expect(url.searchParams.get('secret')).toBe(secret);
      expect(decodeURIComponent(url.pathname)).toContain(SEED_USER.email);
      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      for (const code of recoveryCodes) {
        expect(code).toMatch(/^[A-Z2-7]{10}$/);
      }
      const profile = await owner.get('/api/user/profile').expect(200);
      expect(profile.body).toMatchObject({ data: { twoFactorEnabled: true } });
    });

    it('refuses setup with the wrong password and leaves two-step off', async () => {
      const owner = await loginAs(e2e.httpServer, SEED_USER);

      const refused = await owner
        .post('/api/auth/2fa/setup')
        .send({ password: 'Not-the-password1!' });

      expect(refused.status).toBe(400);
      expect((refused.body as ErrorBody).error.code).toBe(
        ErrorCode.INVALID_CURRENT_PASSWORD,
      );
      const profile = await owner.get('/api/user/profile').expect(200);
      expect(profile.body).toMatchObject({ data: { twoFactorEnabled: false } });
    });

    it('refuses a wrong first code and leaves two-step off', async () => {
      const owner = await loginAs(e2e.httpServer, SEED_USER);
      const setup = await owner
        .post('/api/auth/2fa/setup')
        .send({ password: SEED_USER.password })
        .expect(200);
      const { secret } = (setup.body as { data: { secret: string } }).data;
      // The code of a step ten minutes away, which no window reaches.
      const farCode = totpCodeAt(secret, new Date('2099-01-01T12:10:00.000Z'));

      const refused = await owner
        .post('/api/auth/2fa/confirm')
        .send({ code: farCode });

      expect(refused.status).toBe(401);
      expect((refused.body as ErrorBody).error.code).toBe(
        ErrorCode.TWO_FACTOR_CODE_INVALID,
      );
      const profile = await owner.get('/api/user/profile').expect(200);
      expect(profile.body).toMatchObject({ data: { twoFactorEnabled: false } });
    });
  });

  // feature:email-password:start
  describe('the second step', () => {
    it('holds the sign-in after the password, with no session yet', async () => {
      await enrolled();

      const { agent, response } = await passwordFirstStep(
        e2e.httpServer,
        SEED_USER,
      );

      expect(response.status).toBe(200);
      expect((response.body as SignedInBody).data).toEqual({
        requiresTwoFactor: true,
        user: null,
      });
      expect(cookieNames(response)).toEqual([TWO_FACTOR_CHALLENGE_COOKIE]);
      await agent.get('/api/user/profile').expect(401);
    });

    it('signs in with the code the authenticator shows next', async () => {
      const { secret } = await enrolled();
      jest.setSystemTime(STEP_TWO);
      const { agent } = await passwordFirstStep(e2e.httpServer, SEED_USER);

      const answered = await answerSecondStep(agent, {
        code: totpCodeAt(secret, STEP_TWO),
      });

      await expectSignedIn(agent, answered);
      await expectSecondFactorEvidence(e2e, answered, 'totp');
    });

    it('refuses the code that already confirmed the setup', async () => {
      const { secret } = await enrolled();
      const { agent } = await passwordFirstStep(e2e.httpServer, SEED_USER);

      const answered = await answerSecondStep(agent, {
        code: totpCodeAt(secret, STEP_ONE),
      });

      await expectCodeRefused(agent, answered);
    });

    it('signs in with a recovery code as it was handed out', async () => {
      const { recoveryCodes } = await enrolled();
      const { agent } = await passwordFirstStep(e2e.httpServer, SEED_USER);

      const answered = await answerSecondStep(agent, {
        recoveryCode: recoveryCodes[0],
      });

      await expectSignedIn(agent, answered);
      await expectSecondFactorEvidence(e2e, answered, 'recovery_code');
    });

    it('signs in with a recovery code retyped in lower case with a dash', async () => {
      const { recoveryCodes } = await enrolled();
      const code = recoveryCodes[1].toLowerCase();
      const { agent } = await passwordFirstStep(e2e.httpServer, SEED_USER);

      const answered = await answerSecondStep(agent, {
        recoveryCode: `${code.slice(0, 5)}-${code.slice(5)}`,
      });

      await expectSignedIn(agent, answered);
    });

    it('refuses a recovery code a second time', async () => {
      const { recoveryCodes } = await enrolled();
      const first = await passwordFirstStep(e2e.httpServer, SEED_USER);
      await answerSecondStep(first.agent, {
        recoveryCode: recoveryCodes[0],
      }).then((answered) => expect(answered.status).toBe(200));
      const second = await passwordFirstStep(e2e.httpServer, SEED_USER);

      const answered = await answerSecondStep(second.agent, {
        recoveryCode: recoveryCodes[0],
      });

      await expectCodeRefused(second.agent, answered);
    });
  });

  describe('turning it off', () => {
    it('turns two-step off for a code and the password, and sign-in is one step again', async () => {
      const { owner, secret } = await enrolled();
      jest.setSystemTime(STEP_TWO);

      const off = await owner.post('/api/auth/2fa/disable').send({
        code: totpCodeAt(secret, STEP_TWO),
        password: SEED_USER.password,
      });

      expect(off.status).toBe(200);
      const { response } = await passwordFirstStep(e2e.httpServer, SEED_USER);
      expect((response.body as SignedInBody).data).toMatchObject({
        requiresTwoFactor: false,
        user: { email: SEED_USER.email },
      });
    });

    it('keeps two-step on when the password is left out', async () => {
      const { owner, secret } = await enrolled();
      jest.setSystemTime(STEP_TWO);

      const refused = await owner
        .post('/api/auth/2fa/disable')
        .send({ code: totpCodeAt(secret, STEP_TWO) });

      expect(refused.status).toBe(401);
      expect((refused.body as ErrorBody).error.code).toBe(
        ErrorCode.REAUTH_REQUIRED,
      );
      const { response } = await passwordFirstStep(e2e.httpServer, SEED_USER);
      expect((response.body as SignedInBody).data.requiresTwoFactor).toBe(true);
    });
  });

  describe('replacing the recovery codes', () => {
    it('hands out ten new codes, and only the new ones sign in', async () => {
      const { owner, secret, recoveryCodes: old } = await enrolled();
      jest.setSystemTime(STEP_TWO);

      const replaced = await owner
        .post('/api/auth/2fa/recovery-codes/regenerate')
        .send({
          code: totpCodeAt(secret, STEP_TWO),
          password: SEED_USER.password,
        });

      expect(replaced.status).toBe(200);
      const fresh = (replaced.body as { data: { recoveryCodes: string[] } })
        .data.recoveryCodes;
      expect(fresh).toHaveLength(10);
      expect(fresh.filter((code) => old.includes(code))).toEqual([]);
      const stale = await passwordFirstStep(e2e.httpServer, SEED_USER);
      await expectCodeRefused(
        stale.agent,
        await answerSecondStep(stale.agent, { recoveryCode: old[0] }),
      );
      jest.setSystemTime(STEP_THREE);
      const current = await passwordFirstStep(e2e.httpServer, SEED_USER);
      await expectSignedIn(
        current.agent,
        await answerSecondStep(current.agent, { recoveryCode: fresh[0] }),
      );
    });

    it('refuses to replace them for a wrong code and keeps the old ones', async () => {
      const { owner, secret, recoveryCodes } = await enrolled();

      const refused = await owner
        .post('/api/auth/2fa/recovery-codes/regenerate')
        .send({
          code: totpCodeAt(secret, STEP_ONE),
          password: SEED_USER.password,
        });

      expect(refused.status).toBe(401);
      expect((refused.body as ErrorBody).error.code).toBe(
        ErrorCode.TWO_FACTOR_CODE_INVALID,
      );
      const { agent } = await passwordFirstStep(e2e.httpServer, SEED_USER);
      await expectSignedIn(
        agent,
        await answerSecondStep(agent, { recoveryCode: recoveryCodes[0] }),
      );
    });
  });
  // feature:email-password:end
});

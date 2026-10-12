import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { unwrapNativeAttemptResult, unwrapNativeAttemptStart } from '@app/sdk';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { AccountProfileStore } from '../../../src/user/stores/account-profile.store';
import { SecondFactorStore } from '../../../src/auth/two-factor/stores/second-factor.store';
import { TwoFactorVerificationService } from '../../../src/auth/two-factor/services/two-factor-verification.service';
import { SessionRevocationStore } from '../../../src/session/revocation/session-revocation.store';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_USER } from '../../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../../utils/e2e-app';
import {
  applyTwoFactorEnv,
  enrolTwoFactor,
  totpCodeAt,
} from '../../utils/auth/two-factor-enrolment';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

const APPLICATION = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Native factor version test',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: { password: true, passkeys: false },
};

describe('native second factor account version (e2e)', () => {
  let e2e: E2eApp;
  let restoreEnv: () => void;

  beforeAll(async () => {
    restoreEnv = applyTwoFactorEnv();
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      nativeCustomSchemeAllowed: true,
      nativeApplications: [APPLICATION],
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
    restoreEnv();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('auth.nativeApplications', [APPLICATION]);
    await e2e.reset();
    jest.useFakeTimers({
      now: TEST_NOW,
      doNotFake: [
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });

  afterEach(() => jest.useRealTimers());

  async function start() {
    const query = nativeAuthorizeQuery(randomBytes(32).toString('base64url'));
    const response = await request(e2e.httpServer)
      .post('/api/auth/native/attempts')
      .send({
        clientId: NATIVE_CLIENT_ID,
        redirectUri: NATIVE_REDIRECT,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: 'S256',
        state: query.state,
        scopes: [DEFAULT_API_AUDIENCE],
        flow: 'signIn',
      })
      .expect(201);
    return unwrapNativeAttemptStart({
      status: response.status,
      body: response.body,
    });
  }

  async function heldAttempt() {
    const attempt = await start();
    const response = await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/password`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send({ email: SEED_USER.email, password: SEED_USER.password })
      .expect(201);
    expect(
      unwrapNativeAttemptResult({
        status: response.status,
        body: response.body,
      }).stage,
    ).toBe('secondFactorRequired');
    return attempt;
  }

  async function advanceVersion(userId: string) {
    await e2e.app
      .get(UnitOfWorkRunner)
      .run((work) =>
        e2e.app.get(SessionRevocationStore).advanceAccountVersion(work, userId),
      );
  }

  async function answer(
    attempt: { attemptId: string; attemptSecret: string },
    input: { code?: string; recoveryCode?: string },
  ) {
    return request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/second-factor`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .send(input);
  }

  async function failures(userId: string) {
    const account = await e2e.app
      .get(SecondFactorStore)
      .findChallengedAccount(userId);
    if (!account) throw new Error('account missing');
    return {
      failedAttempts: account.twoFactor.failedAttempts,
      lockedUntil: account.twoFactor.lockedUntil,
    };
  }

  it('does not count five stale answers or lock a fresh MFA attempt', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const { recoveryCodes, secret } = await enrolTwoFactor(
      browser,
      SEED_USER.password,
      TEST_NOW,
    );
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('seed account missing');
    const stale = await heldAttempt();
    await advanceVersion(userId);
    const wrongCode =
      totpCodeAt(secret, TEST_NOW) === '000000' ? '000001' : '000000';

    for (let answerNumber = 0; answerNumber < 5; answerNumber += 1) {
      expect((await answer(stale, { code: wrongCode })).status).toBe(409);
    }
    expect(await failures(userId)).toEqual({
      failedAttempts: 0,
      lockedUntil: null,
    });

    const fresh = await heldAttempt();
    const accepted = await answer(fresh, { recoveryCode: recoveryCodes[0] });
    expect(accepted.status).toBe(201);
    expect(
      unwrapNativeAttemptResult({
        status: accepted.status,
        body: accepted.body,
      }).stage,
    ).toBe('consentRequired');
  });

  it('refuses a reservation from a snapshot taken before an account version change', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const { secret } = await enrolTwoFactor(
      browser,
      SEED_USER.password,
      TEST_NOW,
    );
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!userId) throw new Error('seed account missing');
    await heldAttempt();
    const account = await e2e.app
      .get(SecondFactorStore)
      .findChallengedAccount(userId);
    const profile = await e2e.app.get(AccountProfileStore).findProfile(userId);
    if (!account || !profile) throw new Error('account snapshot missing');
    const wrongCode =
      totpCodeAt(secret, TEST_NOW) === '000000' ? '000001' : '000000';
    await advanceVersion(userId);
    expect(
      (await e2e.app.get(AccountProfileStore).findProfile(userId))
        ?.sessionVersion,
    ).toBe(profile.sessionVersion + 1);
    const outcome = await e2e.app
      .get(TwoFactorVerificationService)
      .prepareNativeSecondFactor(
        account,
        { code: wrongCode },
        profile.sessionVersion,
      )
      .then(
        () => 'reserved',
        () => 'refused',
      );
    expect(await failures(userId)).toEqual({
      failedAttempts: 0,
      lockedUntil: null,
    });
    expect(outcome).toBe('refused');
  });
});

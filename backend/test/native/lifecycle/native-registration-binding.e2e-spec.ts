import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { unwrapNativeAttemptStart } from '@app/sdk';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { NativeAttemptService } from '../../../src/auth/native/services/native-attempt.service';
import { NATIVE_ATTEMPT_PHASE } from '../../../src/auth/native/constants/native-attempt';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import { nativeAuthorizeQuery } from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  NATIVE_LIFECYCLE_APPLICATION,
  parseLifecycleResult,
  postLifecycle,
} from './native-lifecycle.fixtures';

const APPLICATION_X = 'native-registration-x';
const APPLICATION_Y = 'native-registration-y';
const EMAIL = 'native-application-binding@example.test';
const APPLICATIONS = [APPLICATION_X, APPLICATION_Y].map((clientId) => ({
  ...NATIVE_LIFECYCLE_APPLICATION,
  clientId,
}));

describe('native registration application binding (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      nativeCustomSchemeAllowed: true,
      nativeApplications: APPLICATIONS,
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function start(clientId: string) {
    const query = nativeAuthorizeQuery(randomBytes(32).toString('base64url'));
    const response = await request(e2e.httpServer)
      .post('/api/auth/native/attempts')
      .send({
        clientId,
        redirectUri: NATIVE_LIFECYCLE_APPLICATION.redirectUris[0],
        codeChallenge: query.code_challenge,
        codeChallengeMethod: 'S256',
        state: query.state,
        scopes: [DEFAULT_API_AUDIENCE],
        flow: 'registration',
      })
      .expect(201);
    return unwrapNativeAttemptStart({
      status: response.status,
      body: response.body,
    });
  }

  // Failure: an activation code issued by application X creates an account through application Y.
  it('rejects another application code even with the same address and generation commitment', async () => {
    const first = await start(APPLICATION_X);
    await postLifecycle(e2e, first, 'register', { email: EMAIL }).expect(200);
    const code = await e2e.mailedCode();
    const attempts = e2e.app.get(NativeAttemptService);
    const issued = await attempts.authenticate(
      first.attemptId,
      first.attemptSecret,
    );
    const second = await start(APPLICATION_Y);
    const claimed = await attempts.claim(
      second.attemptId,
      second.attemptSecret,
      NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
    );
    await attempts.transition(
      claimed,
      NATIVE_ATTEMPT_PHASE.REGISTRATION_CODE_REQUIRED,
      {
        ...claimed.details,
        email: issued.details.email,
        emailCodeGenerationHash: issued.details.emailCodeGenerationHash,
      },
    );
    const input = {
      email: EMAIL,
      code,
      password: 'NativePassword123!',
      name: 'Native registration binding',
    };
    const refused = await postLifecycle(e2e, second, 'activate', input).expect(
      400,
    );
    expect(refused.body.error.code).toBe(ErrorCode.ACTIVATION_CODE_INVALID);
    expect(await e2e.state.accounts.accountIdFor(EMAIL)).toBeNull();
    expect(await e2e.state.auth.countPendingRegistrations(EMAIL)).toBe(1);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    const accepted = await postLifecycle(e2e, first, 'activate', input).expect(
      200,
    );
    expect(parseLifecycleResult(accepted).stage).toBe('consentRequired');
    expect(await e2e.state.auth.countAccountsWithAddress(EMAIL)).toBe(1);
  });
});

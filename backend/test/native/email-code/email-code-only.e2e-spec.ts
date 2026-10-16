import request from 'supertest';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { NATIVE_CLIENT_ID } from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { TEST_NOW } from '../../utils/frozen-clock';
import type { E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  parseLifecycleResult,
  postLifecycle,
  startLifecycleAttempt,
  storedAttempt,
} from '../lifecycle/native-lifecycle.fixtures';
import {
  bootEmailCodeApp,
  CODE_ONLY_APPLICATION,
  errorCodeOf,
  lastSignInMail,
  requestCode,
  setEmailCode,
  verifyCode,
} from './email-code.fixtures';

const PERSON = 'code-only@example.test';

/** `MAGIC_LINK_ENABLED` stays false: the fixture's default when not asked for. */
describe('native email code as the only way in, magic link switched off (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootEmailCodeApp(CODE_ONLY_APPLICATION, false);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    setEmailCode(e2e, true, CODE_ONLY_APPLICATION);
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  function methods() {
    return request(e2e.httpServer)
      .get('/api/auth/native/methods')
      .query({ clientId: NATIVE_CLIENT_ID })
      .expect(200);
  }

  it('offers email code alone, mails no button, and signs in by code', async () => {
    const offered: unknown = (await methods()).body;
    expect(offered).toMatchObject({
      data: {
        nativeEnabled: true,
        methods: { magicLink: false },
        capabilities: { emailLink: false, emailCode: true },
      },
    });
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    expect(attempt.factors).toEqual(['emailCode']);

    await requestCode(e2e, attempt, PERSON).expect(200);
    const mail = await lastSignInMail(e2e);
    expect(mail.link).toBeNull();
    expect(mail.text).not.toContain('myapp://');
    expect(
      (await storedAttempt(e2e, attempt)).details.emailTokenHash,
    ).toBeNull();

    const verified = await verifyCode(e2e, attempt, mail.code).expect(200);
    expect(parseLifecycleResult(verified).stage).toBe('consentRequired');
    expect(
      (await storedAttempt(e2e, attempt)).details.verifiedAccount?.firstFactor,
    ).toBe('emailCode');
  });

  it('keeps both email link routes disabled', async () => {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    for (const response of [
      await postLifecycle(e2e, attempt, 'email-link/request', {
        email: PERSON,
      }),
      await postLifecycle(e2e, attempt, 'email-link/verify', {
        token: 'token',
        state: 'state',
      }),
    ]) {
      expect(response.status).toBe(404);
      expect(errorCodeOf(response)).toBe(ErrorCode.FEATURE_DISABLED);
    }
    expect(await e2e.captureMail()).toHaveLength(0);
  });

  it('turns the capability off with EMAIL_CODE_ENABLED, leaving no attempt to start', async () => {
    setEmailCode(e2e, false, CODE_ONLY_APPLICATION);
    const offered: unknown = (await methods()).body;
    expect(offered).toHaveProperty('data.capabilities');
    expect(offered).not.toHaveProperty('data.capabilities.emailCode');
    const started = await request(e2e.httpServer)
      .post('/api/auth/native/attempts')
      .send({
        clientId: NATIVE_CLIENT_ID,
        redirectUri: CODE_ONLY_APPLICATION.redirectUris[0],
        codeChallenge: 'a'.repeat(43),
        codeChallengeMethod: 'S256',
        state: 'state',
        scopes: CODE_ONLY_APPLICATION.allowedScopes,
        flow: 'signIn',
      });
    expect(started.status).toBe(404);
    expect(errorCodeOf(started)).toBe(ErrorCode.FEATURE_DISABLED);
  });
});

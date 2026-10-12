import { createHash } from 'node:crypto';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { hashMagicLinkToken } from '../../../src/auth/magic-link/utils/magic-link-token.util';
import { NATIVE_ATTEMPT_PHASE } from '../../../src/auth/native/constants/native-attempt';
import {
  bootNativeLifecycleApp,
  callbackFromMail,
  parseLifecycleResult,
  postLifecycle,
  startLifecycleAttempt,
  storedAttempt,
  type StartedLifecycleAttempt,
} from './native-lifecycle.fixtures';
import { browserAgent } from '../../utils/e2e-sign-in';
import { TEST_NOW } from '../../utils/frozen-clock';
import type { E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

describe('native email-link lifecycle contract', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootNativeLifecycleApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  function requestLink(attempt: StartedLifecycleAttempt, email: string) {
    return postLifecycle(e2e, attempt, 'email-link/request', { email });
  }

  function nativeTokenFromMail(index = e2e.mail.length - 1): {
    token: string;
    attemptId: string;
    state: string;
  } {
    const callback = callbackFromMail(e2e.mail.slice(0, index + 1));
    const token = callback.searchParams.get('native_email_token');
    const attemptId = callback.searchParams.get('native_attempt_id');
    const state = callback.searchParams.get('state');
    if (!token || !attemptId || !state) {
      throw new Error('native callback is missing protocol fields');
    }
    return { token, attemptId, state };
  }

  it('hands the mailed URI through its attempt and verifies the exact token and state', async () => {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    const email = 'native-link@example.test';
    const requested = await requestLink(attempt, email).expect(200);
    expect(parseLifecycleResult(requested).stage).toBe('emailLinkSent');
    await e2e.captureMail();

    const mailed = nativeTokenFromMail();
    expect(mailed.attemptId).toBe(attempt.attemptId);
    const persisted = await storedAttempt(e2e, attempt);
    expect(persisted.phase).toBe(NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT);
    expect(persisted.details.emailTokenHash).toBe(
      createHash('sha256').update(mailed.token).digest('hex'),
    );
    expect(JSON.stringify(persisted)).not.toContain(mailed.token);

    const verified = await postLifecycle(e2e, attempt, 'email-link/verify', {
      token: mailed.token,
      state: mailed.state,
    }).expect(200);
    expect(parseLifecycleResult(verified).stage).toBe('consentRequired');
    expect(verified.headers['set-cookie']).toBeUndefined();
    const consumed = await storedAttempt(e2e, attempt);
    expect(consumed.details.emailTokenHash).toBeNull();
    expect(consumed.details.verifiedAccount?.firstFactor).toBe('emailLink');
    expect(await e2e.state.accounts.accountIdFor(email)).not.toBeNull();
  });

  it('replaces a resend token and rejects a browser token, wrong state, and wrong attempt', async () => {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    const otherAttempt = await startLifecycleAttempt(e2e, 'signIn');
    const email = 'native-link-resend@example.test';
    await requestLink(attempt, email).expect(200);
    await e2e.captureMail();
    const first = nativeTokenFromMail();
    await requestLink(attempt, email).expect(200);
    await e2e.captureMail();
    const second = nativeTokenFromMail();

    const browser = await browserAgent(e2e.httpServer);
    await browser
      .post('/api/auth/magic-link/request')
      .send({ email })
      .expect(200);
    await e2e.captureMail();
    const browserToken = /[?&]token=([A-Za-z0-9_-]+)/u.exec(
      e2e.mail.at(-1)?.text ?? '',
    )?.[1];
    if (!browserToken) throw new Error('browser magic-link token missing');

    await postLifecycle(e2e, attempt, 'email-link/verify', {
      token: first.token,
      state: first.state,
    }).expect(400);
    await postLifecycle(e2e, attempt, 'email-link/verify', {
      token: browserToken,
      state: second.state,
    }).expect(400);
    await postLifecycle(e2e, otherAttempt, 'email-link/verify', {
      token: second.token,
      state: second.state,
    }).expect(409);
    await postLifecycle(e2e, attempt, 'email-link/verify', {
      token: second.token,
      state: 'wrong-state',
    }).expect(400);

    const persisted = await storedAttempt(e2e, attempt);
    expect(persisted.phase).toBe(NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT);
    expect(persisted.details.emailTokenHash).toBe(
      hashMagicLinkToken(second.token),
    );
    const verified = await postLifecycle(e2e, attempt, 'email-link/verify', {
      token: second.token,
      state: second.state,
    }).expect(200);
    expect(parseLifecycleResult(verified).stage).toBe('consentRequired');
  });

  it('keeps address enumeration generic and blocks browser-origin requests', async () => {
    const deletedEmail = 'native-link-deleted@example.test';
    await e2e.state.accounts.createAccount({
      email: deletedEmail,
      name: 'Deleted',
      isDeleted: true,
    });
    const missingAttempt = await startLifecycleAttempt(e2e, 'signIn');
    const deletedAttempt = await startLifecycleAttempt(e2e, 'signIn');
    const mailCount = (await e2e.captureMail()).length;
    const missing = await requestLink(
      missingAttempt,
      'native-link-missing@example.test',
    ).expect(200);
    const missingMail = await e2e.captureMail();
    const deleted = await requestLink(deletedAttempt, deletedEmail).expect(200);
    const deletedMail = await e2e.captureMail();
    expect(parseLifecycleResult(missing)).toMatchObject({
      stage: 'emailLinkSent',
      email: 'native-link-missing@example.test',
    });
    expect(parseLifecycleResult(deleted)).toMatchObject({
      stage: 'emailLinkSent',
      email: deletedEmail,
    });
    expect(missingMail).toHaveLength(mailCount + 1);
    expect(missingMail.at(-1)?.to).toContain(
      'native-link-missing@example.test',
    );
    expect(deletedMail).toHaveLength(missingMail.length);

    const blocked = await postLifecycle(
      e2e,
      missingAttempt,
      'email-link/request',
      { email: 'blocked@example.test' },
    )
      .set('Origin', 'https://example.test')
      .expect(403);
    expect(blocked.headers['set-cookie']).toBeUndefined();
  });

  it('rejects callback verification after the attempt expires', async () => {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    await requestLink(attempt, 'native-link-expired@example.test').expect(200);
    await e2e.captureMail();
    const mailed = nativeTokenFromMail();
    e2e.clock.advance(15 * 60 * 1000);
    const expired = await postLifecycle(e2e, attempt, 'email-link/verify', {
      token: mailed.token,
      state: mailed.state,
    }).expect(410);
    expect(expired.body.error.code).toBe(ErrorCode.NATIVE_TRANSACTION_EXPIRED);
  });
});

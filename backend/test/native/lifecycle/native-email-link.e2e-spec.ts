import { createHash } from 'node:crypto';
import { AddressLedger } from '../../../src/common/persistence/address-ledger';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { holdAddress } from '../../utils/address-claim';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { hashMagicLinkToken } from '../../../src/auth/magic-link/utils/magic-link-token.util';
import { NATIVE_ATTEMPT_PHASE } from '../../../src/auth/native/constants/native-attempt';
import { ACCOUNT_CREATION_METHOD } from '../../../src/auth/constants/account-creation';
import { UnitOfWork } from '../../../src/common/persistence/unit-of-work';
import { NATIVE_CLIENT_ID } from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import {
  installAccountCreationPolicy,
  type SwitchableAccountCreationPolicy,
} from '../../utils/account-creation-policy';
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
  let policy: SwitchableAccountCreationPolicy;

  beforeAll(async () => {
    e2e = await bootNativeLifecycleApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    policy = installAccountCreationPolicy(e2e.app);
  });

  afterEach(() => jest.restoreAllMocks());

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

  function assertNativeCreationPolicy(
    calls: SwitchableAccountCreationPolicy['calls'],
  ): void {
    const observed = calls.find(
      ({ request }) =>
        request.application === NATIVE_CLIENT_ID &&
        request.method === ACCOUNT_CREATION_METHOD.MAGIC_LINK,
    );
    expect(observed?.request).toEqual({
      application: NATIVE_CLIENT_ID,
      method: ACCOUNT_CREATION_METHOD.MAGIC_LINK,
    });
    expect(observed?.unitOfWork).toBeInstanceOf(UnitOfWork);
  }

  it('hands the mailed URI through its attempt and verifies the exact token and state', async () => {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    const email = 'native-link@example.test';
    const requested = await requestLink(attempt, email).expect(200);
    expect(parseLifecycleResult(requested).stage).toBe('emailLinkSent');
    assertNativeCreationPolicy(policy.calls);
    const requestPolicyCalls = policy.calls.length;
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
    assertNativeCreationPolicy(policy.calls.slice(requestPolicyCalls));
  });

  it.each(['policy', 'live-claim'])(
    'rolls back native creation when %s refuses',
    async (mode) => {
      const attempt = await startLifecycleAttempt(e2e, 'signIn');
      const email = 'native-link-policy-refused@example.test';
      await requestLink(attempt, email).expect(200);
      assertNativeCreationPolicy(policy.calls);
      const requestPolicyCalls = policy.calls.length;
      await e2e.captureMail();
      const mailed = nativeTokenFromMail();
      const before = await storedAttempt(e2e, attempt);
      policy.refused = mode === 'policy';
      if (mode === 'live-claim') {
        await holdAddress(
          e2e.app.get(AddressLedger),
          e2e.app.get(UnitOfWorkRunner),
          e2e.clock,
          email,
        );
      }

      const refused = await postLifecycle(e2e, attempt, 'email-link/verify', {
        token: mailed.token,
        state: mailed.state,
      }).expect(mode === 'policy' ? 403 : 400);

      expect(refused.body.error.code).toBe(
        mode === 'policy'
          ? ErrorCode.ACCOUNT_CREATION_REFUSED
          : ErrorCode.MAGIC_LINK_INVALID,
      );
      assertNativeCreationPolicy(policy.calls.slice(requestPolicyCalls));
      expect(await e2e.state.accounts.accountIdFor(email)).toBeNull();
      expect(await e2e.state.auth.countAddressClaims(email)).toBe(
        mode === 'policy' ? 0 : 1,
      );
      expect(await e2e.state.sessions.countSessions()).toBe(0);
      const after = await storedAttempt(e2e, attempt);
      expect(after.phase).toBe(before.phase);
      expect(after.details).toEqual(before.details);
      expect(after.activeOperationId).toBeNull();
    },
  );

  it('signs an existing account in while creation is refused without applying it to verification', async () => {
    const email = 'native-link-existing@example.test';
    const account = await e2e.state.accounts.createAccount({
      email,
      name: 'Existing link account',
      isVerified: true,
    });
    policy.refused = true;
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    await requestLink(attempt, email).expect(200);
    assertNativeCreationPolicy(policy.calls);
    const requestPolicyCalls = policy.calls.length;
    await e2e.captureMail();
    const mailed = nativeTokenFromMail();

    const verified = await postLifecycle(e2e, attempt, 'email-link/verify', {
      token: mailed.token,
      state: mailed.state,
    }).expect(200);

    expect(parseLifecycleResult(verified)).toMatchObject({
      stage: 'consentRequired',
      account: { id: account._id },
    });
    expect(policy.calls.slice(requestPolicyCalls)).toEqual([]);
    expect(await e2e.state.auth.countAccountsWithAddress(email)).toBe(1);
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

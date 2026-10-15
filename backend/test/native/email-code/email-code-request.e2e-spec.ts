import request from 'supertest';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { MailService } from '../../../src/mail/mail.service';
import { NATIVE_ATTEMPT_HEADER } from '../../../src/auth/native/constants/native-attempt';
import { hashMagicLinkToken } from '../../../src/auth/magic-link/utils/magic-link-token.util';
import { UserProfileService } from '../../../src/user/services/user-profile.service';
import { MAIL_CATALOGUES } from '../../../src/mail/catalog/mail-catalogue';
import { formatMessage } from '../../../src/mail/catalog/format-message';
import {
  installAccountCreationPolicy,
  type SwitchableAccountCreationPolicy,
} from '../../utils/account-creation-policy';
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
  asAnotherCaller,
  ATTEMPT_LIFETIME_MS,
  bootEmailCodeApp,
  EMAIL_CODE_APPLICATION,
  errorCodeOf,
  lastSignInMail,
  requestCode,
  setEmailCode,
  storedCode,
  verifyCode,
  watchHashedCodes,
} from './email-code.fixtures';

const KNOWN = 'known-person@example.test';
const UNKNOWN = 'new-person@example.test';
/** Within one window: five mails, then none. */
const MAIL_LIMIT = 5;

describe('native email code request (e2e)', () => {
  let e2e: E2eApp;
  let policy: SwitchableAccountCreationPolicy;

  beforeAll(async () => {
    e2e = await bootEmailCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    setEmailCode(e2e, true);
    policy = installAccountCreationPolicy(e2e.app);
    await e2e.state.accounts.createAccount({
      email: KNOWN,
      name: 'Known',
      isVerified: true,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function replyFor(email: string) {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    const response = await requestCode(e2e, attempt, email).expect(200);
    const { attemptId, expiresAt, ...rest } = parseLifecycleResult(response);
    expect({ attemptId, expiresAt }).toEqual({
      attemptId: attempt.attemptId,
      expiresAt: new Date(
        TEST_NOW.getTime() + ATTEMPT_LIFETIME_MS,
      ).toISOString(),
    });
    return { attempt, reply: rest };
  }

  it('mails a known address its code with a button that carries everything after #', async () => {
    const { attempt, reply } = await replyFor(KNOWN);
    expect(reply).toEqual({ stage: 'emailLinkSent', email: KNOWN });
    const mail = await lastSignInMail(e2e);
    expect(mail.to).toBe(KNOWN);
    expect(mail.text).toContain(mail.code);
    expect(mail.code).toMatch(/^[0-9]{6}$/u);
    const link = mail.link;
    if (!link) throw new Error('the mail has no button');
    expect(link.search).toBe('');
    const fragment = new URLSearchParams(link.hash.slice(1));
    expect([...fragment.keys()].sort()).toEqual([
      'native_attempt_id',
      'native_email_token',
      'state',
    ]);
    expect(fragment.get('native_attempt_id')).toBe(attempt.attemptId);
    const persisted = await storedAttempt(e2e, attempt);
    expect(persisted.details.emailTokenHash).toBe(
      hashMagicLinkToken(fragment.get('native_email_token') ?? ''),
    );
    expect(fragment.get('state')).toBe(persisted.state);
    expect(JSON.stringify(persisted)).not.toContain(mail.code);
    expect((await storedCode(e2e, attempt))?.codeHash).not.toContain(mail.code);
  });

  it('gives every refusal the reply a known address gets, and mails only the open sign-up', async () => {
    const known = (await replyFor(KNOWN)).reply;
    const open = (await replyFor(UNKNOWN)).reply;
    expect((await e2e.captureMail()).map((mail) => mail.to)).toEqual([
      KNOWN,
      UNKNOWN,
    ]);
    expect(await e2e.state.accounts.accountIdFor(UNKNOWN)).toBeNull();

    const typed = watchHashedCodes(e2e);
    policy.refused = true;
    const closed = await replyFor('closed-person@example.test');
    const closedCode = typed();
    const deactivated = 'deactivated@example.test';
    await e2e.state.accounts.createAccount({
      email: deactivated,
      name: 'Gone',
      isVerified: true,
      isDeleted: true,
    });
    const gone = await replyFor(deactivated);
    const goneCode = typed();

    expect([open, closed.reply, gone.reply]).toEqual([
      { ...known, email: UNKNOWN },
      { ...known, email: 'closed-person@example.test' },
      { ...known, email: deactivated },
    ]);
    expect(await e2e.captureMail()).toHaveLength(2);
    for (const [attempt, code] of [
      [closed.attempt, closedCode],
      [gone.attempt, goneCode],
    ] as const) {
      expect((await storedCode(e2e, attempt))?.spentAt).toEqual(TEST_NOW);
      const refused = await verifyCode(e2e, attempt, code).expect(400);
      expect(errorCodeOf(refused)).toBe(ErrorCode.EMAIL_CODE_INVALID);
    }
    expect(
      await e2e.state.accounts.accountIdFor('closed-person@example.test'),
    ).toBeNull();
  });

  it('refuses a code mailed before the account was deactivated, with the same code as a wrong one', async () => {
    const { attempt } = await replyFor(KNOWN);
    const { code } = await lastSignInMail(e2e);
    const id = await e2e.state.accounts.accountIdFor(KNOWN);
    if (!id) throw new Error('known account missing');
    await e2e.app.get(UserProfileService).deactivateAccount(id);

    const refused = await verifyCode(e2e, attempt, code).expect(400);
    expect(errorCodeOf(refused)).toBe(ErrorCode.EMAIL_CODE_INVALID);
    const after = await storedAttempt(e2e, attempt);
    expect(after.phase).toBe('emailLinkSent');
    expect(after.details.verifiedAccount).toBeNull();
  });

  it('sends nothing past five mails in a window, answers the same, and stores the sixth code spent', async () => {
    const typed = watchHashedCodes(e2e);
    const replies: Awaited<ReturnType<typeof replyFor>>[] = [];
    for (let mail = 0; mail <= MAIL_LIMIT; mail += 1) {
      asAnotherCaller(e2e);
      replies.push(await replyFor(KNOWN));
    }
    const sixth = replies[MAIL_LIMIT];
    expect(await e2e.captureMail()).toHaveLength(MAIL_LIMIT);
    expect(
      new Set(replies.map(({ reply }) => JSON.stringify(reply))).size,
    ).toBe(1);
    expect((await storedCode(e2e, sixth.attempt))?.spentAt).toEqual(TEST_NOW);
    await verifyCode(e2e, sixth.attempt, typed()).expect(400);
  });

  it('answers the same when sends fail, and retries the send in process', async () => {
    const send = jest.spyOn(e2e.app.get(MailService), 'sendMail');
    send.mockRejectedValueOnce(new Error('smtp down'));
    send.mockRejectedValueOnce(new Error('smtp down'));
    const { attempt, reply } = await replyFor(KNOWN);
    expect(reply).toEqual({ stage: 'emailLinkSent', email: KNOWN });
    const { code } = await lastSignInMail(e2e);
    expect(send).toHaveBeenCalledTimes(3);
    const verified = await verifyCode(e2e, attempt, code).expect(200);
    expect(parseLifecycleResult(verified).stage).toBe('consentRequired');
  });

  it('treats an address in mixed case with spaces as the same address', async () => {
    const { reply } = await replyFor('  Known-Person@Example.TEST ');
    expect(reply).toEqual({ stage: 'emailLinkSent', email: KNOWN });
    expect((await lastSignInMail(e2e)).to).toBe(KNOWN);
  });

  it.each([
    ['an empty address', { email: '' }],
    ['a malformed address', { email: 'not-an-address' }],
    ['no address', {}],
    ['an extra field', { email: KNOWN, code: '123456' }],
  ])('refuses %s and stores nothing', async (_case, body) => {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    const refused = await postLifecycle(
      e2e,
      attempt,
      'email-code/request',
      body,
    ).expect(400);
    expect(errorCodeOf(refused)).toBe(ErrorCode.VALIDATION_ERROR);
    expect(await storedCode(e2e, attempt)).toBeNull();
    expect((await storedAttempt(e2e, attempt)).phase).toBe(
      'firstFactorRequired',
    );
    expect(await e2e.captureMail()).toHaveLength(0);
  });

  it.each([
    ['EMAIL_CODE_ENABLED is off', false, EMAIL_CODE_APPLICATION],
    [
      'the application has no email code',
      true,
      { ...EMAIL_CODE_APPLICATION, signIn: { emailLink: true } },
    ],
  ])(
    'answers both routes as a disabled feature when %s',
    async (_case, enabled, application) => {
      setEmailCode(e2e, enabled, application);
      const attempt = await startLifecycleAttempt(e2e, 'signIn');
      for (const response of [
        await requestCode(e2e, attempt, KNOWN),
        await verifyCode(e2e, attempt, '123456'),
      ]) {
        expect(response.status).toBe(404);
        expect(errorCodeOf(response)).toBe(ErrorCode.FEATURE_DISABLED);
      }
      expect(await e2e.captureMail()).toHaveLength(0);
    },
  );

  it('refuses a wrong secret, an unknown or expired attempt, and one past its first factor', async () => {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    const path = `/api/auth/native/attempts/${attempt.attemptId}/email-code/request`;
    await request(e2e.httpServer)
      .post(path)
      .set(NATIVE_ATTEMPT_HEADER, 'A'.repeat(43))
      .send({ email: KNOWN })
      .expect(401);
    await request(e2e.httpServer)
      .post('/api/auth/native/attempts/unknown/email-code/request')
      .set(NATIVE_ATTEMPT_HEADER, attempt.attemptSecret)
      .send({ email: KNOWN })
      .expect(401);

    await requestCode(e2e, attempt, KNOWN).expect(200);
    const { code } = await lastSignInMail(e2e);
    await verifyCode(e2e, attempt, code).expect(200);
    await requestCode(e2e, attempt, KNOWN).expect(409);

    const late = await startLifecycleAttempt(e2e, 'signIn');
    e2e.clock.advance(ATTEMPT_LIFETIME_MS);
    await requestCode(e2e, late, KNOWN).expect(410);
    expect(await e2e.captureMail()).toHaveLength(1);
  });

  // feature:locale-ar:start
  it('writes an Arabic mail in the account language with the code in Western digits', async () => {
    await e2e.state.accounts.createAccount({
      email: 'arabic@example.test',
      name: 'Layla',
      isVerified: true,
      locale: 'ar',
    });
    await replyFor('arabic@example.test');
    const mail = await lastSignInMail(e2e, 'ar');
    expect(mail.subject).toBe(
      formatMessage(MAIL_CATALOGUES.ar.signInCode.subject, { code: mail.code }),
    );
    expect(mail.code).toMatch(/^[0-9]{6}$/u);
  });
  // feature:locale-ar:end

  it('spends nothing when the button is opened, and refuses its token without the attempt secret', async () => {
    const { attempt } = await replyFor(KNOWN);
    const { code, link } = await lastSignInMail(e2e);
    const fragment = new URLSearchParams(link?.hash.slice(1));
    const before = await storedAttempt(e2e, attempt);

    await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/email-link/verify`)
      .set(NATIVE_ATTEMPT_HEADER, 'B'.repeat(43))
      .send({
        token: fragment.get('native_email_token'),
        state: fragment.get('state'),
      })
      .expect(401);

    expect(await storedAttempt(e2e, attempt)).toEqual(before);
    const verified = await verifyCode(e2e, attempt, code).expect(200);
    expect(parseLifecycleResult(verified).stage).toBe('consentRequired');
  });
});

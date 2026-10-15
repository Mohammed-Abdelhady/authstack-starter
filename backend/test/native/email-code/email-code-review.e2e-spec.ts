import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { EventRecorder } from '../../../src/auth/contracts/event-recorder';
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
  startLifecycleAttempt,
  storedAttempt,
  type StartedLifecycleAttempt,
} from '../lifecycle/native-lifecycle.fixtures';
import {
  asAnotherCaller,
  bootEmailCodeApp,
  errorCodeOf,
  nextCodeIs,
  otherCode,
  requestCode,
  setEmailCode,
  storedCode,
  verifyCode,
} from './email-code.fixtures';

const REVIEWER = 'store-reviewer@example.test';
const FIXED_CODE = '246810';
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** The UTC day after the one `TEST_NOW` falls in. */
const NEXT_DAY = new Date('2099-01-02T00:00:00.000Z');
/** Four other attempts and this one: five wrong codes in one day. */
const OTHER_ATTEMPTS = 4;
/** Resends that fill the address's mail window after the first request. */
const RESENDS_TO_LIMIT = 4;

type ReviewSettings = Partial<
  Record<'accountId' | 'clientId' | 'codeHash' | 'until', string>
>;

describe('native email code review access (e2e)', () => {
  let e2e: E2eApp;
  let fixedHash: string;
  let reviewerId: string;

  beforeAll(async () => {
    e2e = await bootEmailCodeApp();
    fixedHash = await bcrypt.hash(FIXED_CODE, 4);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    setEmailCode(e2e, true);
    setReview({});
    const reviewer = await e2e.state.accounts.createAccount({
      email: REVIEWER,
      name: 'Store Reviewer',
      role: 'user',
      isVerified: true,
    });
    reviewerId = reviewer._id;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  /** Read on every use, so a change takes effect without a restart. */
  function setReview(review: ReviewSettings): void {
    e2e.app.get(ConfigService).set('emailCode.review', review);
  }

  function openReview(overrides: ReviewSettings = {}): void {
    setReview({
      accountId: reviewerId,
      clientId: NATIVE_CLIENT_ID,
      codeHash: fixedHash,
      until: new Date(TEST_NOW.getTime() + 2 * DAY_MS).toISOString(),
      ...overrides,
    });
  }

  async function requested(): Promise<StartedLifecycleAttempt> {
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    await requestCode(e2e, attempt, REVIEWER).expect(200);
    return attempt;
  }

  async function expectRefused(
    attempt: StartedLifecycleAttempt,
    code = FIXED_CODE,
  ): Promise<void> {
    const refused = await verifyCode(e2e, attempt, code).expect(400);
    expect(errorCodeOf(refused)).toBe(ErrorCode.EMAIL_CODE_INVALID);
    expect(
      (await storedAttempt(e2e, attempt)).details.verifiedAccount,
    ).toBeNull();
  }

  it('signs the review account in with the fixed code on its application, mails nothing and records it', async () => {
    openReview();
    const recorded = jest.spyOn(e2e.app.get(EventRecorder), 'record');
    const attempt = await requested();

    const verified = await verifyCode(e2e, attempt, FIXED_CODE).expect(200);

    expect(parseLifecycleResult(verified).stage).toBe('consentRequired');
    expect(
      (await storedAttempt(e2e, attempt)).details.verifiedAccount?.userId,
    ).toBe(reviewerId);
    expect(await e2e.captureMail()).toHaveLength(0);
    expect(recorded.mock.calls.map(([, input]) => input)).toContainEqual({
      action: 'email_code_review_signed_in',
      targetUserId: reviewerId,
      clientId: NATIVE_CLIENT_ID,
    });
  });

  it.each([
    ['review access is unset', () => setReview({})],
    [
      'it names another application',
      () => openReview({ clientId: 'another-app' }),
    ],
  ])(
    'mails the review address like any other and refuses the fixed code when %s',
    async (_case, arrange) => {
      arrange();
      nextCodeIs(otherCode(FIXED_CODE));
      const attempt = await requested();

      expect((await e2e.captureMail()).map(({ to }) => to)).toEqual([REVIEWER]);
      await expectRefused(attempt);
    },
  );

  it.each([
    [
      'gains a staff role',
      () => e2e.state.records.changeAccountRole(reviewerId, 'support'),
    ],
    [
      'gains a permission of its own',
      () =>
        e2e.state.records.replaceAccountPermissions(reviewerId, [
          'users:read:all',
        ]),
    ],
    ['is deactivated', () => e2e.state.records.markAccountDeleted(reviewerId)],
    [
      'passes the end of review access',
      () => {
        e2e.clock.set(new Date(TEST_NOW.getTime() + 5 * MINUTE_MS));
        return Promise.resolve();
      },
    ],
  ])(
    'refuses the fixed code when the account %s after the request',
    async (_case, change) => {
      openReview({
        until: new Date(TEST_NOW.getTime() + 5 * MINUTE_MS).toISOString(),
      });
      const attempt = await requested();
      await change();

      await expectRefused(attempt);
    },
  );

  it('refuses the fixed code once review access is unset after the request', async () => {
    openReview();
    const attempt = await requested();
    setReview({});

    await expectRefused(attempt);
  });

  it('switches review access off for the day after five wrong codes over five attempts, records it, and opens again the next day', async () => {
    openReview();
    const recorded = jest.spyOn(
      e2e.app.get(EventRecorder),
      'recordOutsideUnitOfWork',
    );
    const first = await requested();
    for (let other = 0; other < OTHER_ATTEMPTS; other += 1) {
      await expectRefused(await requested(), otherCode(FIXED_CODE));
    }
    await expectRefused(first, otherCode(FIXED_CODE));
    await expectRefused(first);

    expect(
      recorded.mock.calls
        .map(([input]) => input)
        .filter(({ action }) => action === 'email_code_review_locked'),
    ).toEqual([
      {
        action: 'email_code_review_locked',
        targetUserId: reviewerId,
        clientId: NATIVE_CLIENT_ID,
      },
    ]);

    e2e.clock.set(NEXT_DAY);
    asAnotherCaller(e2e);
    await verifyCode(e2e, await requested(), FIXED_CODE).expect(200);
  });

  it('stores the fixed code spent once the address is past its mail limit', async () => {
    openReview();
    const attempt = await requested();
    for (let resend = 0; resend < RESENDS_TO_LIMIT; resend += 1) {
      await requestCode(e2e, attempt, REVIEWER).expect(200);
    }
    asAnotherCaller(e2e);
    await requestCode(e2e, attempt, REVIEWER).expect(200);

    expect((await storedCode(e2e, attempt))?.spentAt).toEqual(TEST_NOW);
    await expectRefused(attempt);
  });
});

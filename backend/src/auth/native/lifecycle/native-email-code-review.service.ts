import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { SECURITY_EVENT_ACTION } from '../../../session/constants/security-event-action';
import { AccountProfileStore } from '../../../user/stores/account-profile.store';
import type { StoredAccount } from '../../../user/stores/stored-account';
import { EventRecorder } from '../../contracts/event-recorder';
import {
  EmailCodeStore,
  StoredEmailCode,
} from '../../pending-codes/email-code.store';
import { hashPendingCodeGeneration } from '../../utils/pending-code-generation.util';
import type { NativeAttempt } from '../types/native-attempt';
import {
  EmailCodeReview,
  REVIEW_GUESS_LIMIT,
  reviewAccountFits,
  reviewCodeGeneration,
  reviewDay,
  reviewGuessKey,
  reviewOf,
  reviewOpenAt,
} from './email-code-review';

type AccountRead = (accountId: string) => Promise<StoredAccount | null>;

/**
 * A way in for app store reviewers: one customer account on one application
 * accepts a fixed code and is mailed nothing. Every use reads the settings,
 * the account and the day's wrong guesses again, so a change to any of them
 * takes effect without a restart.
 */
@Injectable()
export class NativeEmailCodeReviewService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NativeEmailCodeReviewService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly accounts: AccountProfileStore,
    private readonly codes: EmailCodeStore,
    private readonly events: EventRecorder,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    const review = reviewOf(this.config);
    if (!review) return;
    this.logger.warn(
      `Email code review access is set for account ${review.accountId} on application ${review.clientId} until ${review.until.toISOString()}`,
    );
  }

  /** The fixed code's hash when this request is the review account's, on its application, now. */
  async codeHashFor(
    attempt: NativeAttempt,
    address: string,
  ): Promise<string | null> {
    const review = reviewOf(this.config);
    if (!review) return null;
    const open = await this.opens(review, attempt.clientId, address, (id) =>
      this.accounts.findAccount(id),
    );
    return open ? review.codeHash : null;
  }

  /** The stored code is the fixed one the settings name now. */
  isReviewCode(stored: StoredEmailCode): boolean {
    return reviewOf(this.config)?.codeHash === stored.codeHash;
  }

  /** What an attempt committed to when it stored this code. */
  generationOf(stored: StoredEmailCode): string {
    return this.isReviewCode(stored)
      ? reviewCodeGeneration(stored.codeHash)
      : hashPendingCodeGeneration(stored.codeHash);
  }

  /** Review access still lets this attempt's address in on its application. */
  async usableFor(attempt: NativeAttempt): Promise<boolean> {
    const review = reviewOf(this.config);
    if (!review) return false;
    return this.opens(
      review,
      attempt.clientId,
      attempt.details.email?.address,
      (id) => this.accounts.findAccount(id),
    );
  }

  /**
   * Checks again inside the unit of work that completes the sign-in, and
   * records the sign-in there, so the two commit together.
   * @throws the refusal when review access no longer lets the attempt in
   */
  async admitIn(
    unitOfWork: UnitOfWork,
    claimed: NativeAttempt,
    refuse: () => Error,
  ): Promise<void> {
    const review = reviewOf(this.config);
    const open =
      review !== null &&
      (await this.opens(
        review,
        claimed.clientId,
        claimed.details.email?.address,
        (id) => this.accounts.readAccount(unitOfWork, id),
      ));
    if (!review || !open) throw refuse();
    await this.events.record(unitOfWork, {
      action: SECURITY_EVENT_ACTION.EMAIL_CODE_REVIEW_SIGNED_IN,
      targetUserId: review.accountId,
      clientId: claimed.clientId,
    });
  }

  /**
   * Counts a wrong guess at the fixed code on the account's day, from any
   * attempt, and switches review access off for the rest of the day at the
   * limit. No new attempt resets the count.
   */
  async countWrongGuess(attempt: NativeAttempt): Promise<void> {
    const review = reviewOf(this.config);
    if (!review) return;
    const day = reviewDay(this.clock.now());
    const key = reviewGuessKey(review.accountId, day.key);
    if (!(await this.codes.find(key))) {
      // Stored spent with no code: the row only counts guesses.
      await this.codes.put({
        ...key,
        email: attempt.details.email?.address ?? '',
        codeHash: '',
        expiresAt: day.ends,
        purgeAfter: day.ends,
        spent: true,
      });
    }
    const guesses = await this.codes.recordWrongGuess(key, REVIEW_GUESS_LIMIT);
    if (guesses !== REVIEW_GUESS_LIMIT) return;
    this.logger.warn(
      `Email code review access is off until ${day.ends.toISOString()} after ${REVIEW_GUESS_LIMIT} wrong codes`,
    );
    await this.events.recordOutsideUnitOfWork({
      action: SECURITY_EVENT_ACTION.EMAIL_CODE_REVIEW_LOCKED,
      targetUserId: review.accountId,
      clientId: attempt.clientId,
    });
  }

  private async opens(
    review: EmailCodeReview,
    clientId: string,
    address: string | undefined,
    readAccount: AccountRead,
  ): Promise<boolean> {
    if (
      clientId !== review.clientId ||
      !reviewOpenAt(review, this.clock.now()) ||
      !this.accounts.isAccountId(review.accountId)
    ) {
      return false;
    }
    const account = await readAccount(review.accountId);
    return (
      reviewAccountFits(account, review, address) &&
      !(await this.lockedToday(review))
    );
  }

  private async lockedToday(review: EmailCodeReview): Promise<boolean> {
    const day = reviewDay(this.clock.now());
    const guesses = await this.codes.find(
      reviewGuessKey(review.accountId, day.key),
    );
    return (guesses?.wrongGuesses ?? 0) >= REVIEW_GUESS_LIMIT;
  }
}

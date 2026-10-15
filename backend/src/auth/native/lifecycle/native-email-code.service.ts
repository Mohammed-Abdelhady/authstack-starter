import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupportedLocale } from '../../../common/constants/locales';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { Clock } from '../../../common/services/clock';
import { HashService } from '../../../common/services/hash.service';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import {
  EMAIL_CODE_GUESS_LIMIT,
  EMAIL_CODE_PURPOSE,
  EmailCodeKey,
  EmailCodeStore,
  StoredEmailCode,
} from '../../pending-codes/email-code.store';
import { matchesPendingCodeGeneration } from '../../utils/pending-code-generation.util';
import {
  NATIVE_ATTEMPT_FIRST_FACTOR,
  NATIVE_ATTEMPT_FLOW,
  NATIVE_ATTEMPT_PHASE,
} from '../constants/native-attempt';
import { NativeAttemptService } from '../services/native-attempt.service';
import { NativeMethodsService } from '../services/native-methods.service';
import type {
  NativeAttempt,
  NativeAttemptPhase,
} from '../types/native-attempt';
import { featureDisabled, wrongStage } from '../utils/native-attempt-errors';
import { NativeEmailCodeMailService } from './native-email-code-mail.service';
import { NativeEmailCodeReviewService } from './native-email-code-review.service';
import { NativeEmailLinkService } from './native-email-link.service';

const REQUEST_PHASES: NativeAttemptPhase[] = [
  NATIVE_ATTEMPT_PHASE.FIRST_FACTOR_REQUIRED,
  NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT,
];
const VERIFY_PHASES: NativeAttemptPhase[] = [
  NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT,
];
/** Tries at ending an attempt whose revision another call moved meanwhile. */
const END_ATTEMPT_PASSES = 2;

function emailCodeInvalid(): AppException {
  return new AppException(
    ErrorCode.EMAIL_CODE_INVALID,
    'Email code invalid',
    HttpStatus.BAD_REQUEST,
  );
}

@Injectable()
export class NativeEmailCodeService {
  private readonly logger = new Logger(NativeEmailCodeService.name);

  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly methods: NativeMethodsService,
    private readonly issuer: NativeEmailCodeMailService,
    private readonly emailLink: NativeEmailLinkService,
    private readonly codes: EmailCodeStore,
    private readonly hashService: HashService,
    private readonly config: ConfigService,
    private readonly clock: Clock,
    private readonly review: NativeEmailCodeReviewService,
  ) {}

  async request(
    attemptId: string,
    secret: string,
    email: string,
    locale: SupportedLocale,
  ) {
    const { attempt, withLink } = await this.requireAttempt(
      attemptId,
      secret,
      REQUEST_PHASES,
    );
    const claimed = await this.attempts.claim(attemptId, secret, attempt.phase);
    let stored = false;
    try {
      const issued = await this.issuer.issue(
        { email, locale },
        claimed,
        withLink,
      );
      const next = await this.attempts.transition(
        claimed,
        NATIVE_ATTEMPT_PHASE.EMAIL_LINK_SENT,
        {
          ...claimed.details,
          email: {
            address: email,
            generation: null,
            requestedAt: this.clock.now(),
          },
          emailTokenHash: issued.tokenHash,
          emailCodeGenerationHash: issued.generationHash,
        },
      );
      stored = true;
      issued.deliver?.();
      return this.attempts.view(next);
    } catch (error) {
      if (!stored) await this.attempts.release(claimed);
      throw error;
    }
  }

  async verify(
    attemptId: string,
    secret: string,
    code: string,
    locale: SupportedLocale,
  ) {
    const { attempt } = await this.requireAttempt(
      attemptId,
      secret,
      VERIFY_PHASES,
    );
    const key: EmailCodeKey = {
      ownerId: attempt.attemptId,
      purpose: EMAIL_CODE_PURPOSE.SIGN_IN,
    };
    const stored = await this.codes.find(key);
    if (!stored || !this.committed(attempt, stored)) throw emailCodeInvalid();
    const review = this.review.isReviewCode(stored);
    await this.assertRightGuess({ attempt, key, stored, code, review }, secret);
    if (!this.live(stored)) throw emailCodeInvalid();
    const completed = await this.emailLink.completeWithProof(
      attempt,
      attemptId,
      secret,
      locale,
      {
        firstFactor: NATIVE_ATTEMPT_FIRST_FACTOR.EMAIL_CODE,
        spendIn: async (unitOfWork, claimed) => {
          if (
            !this.committed(claimed, stored) ||
            !(await this.codes.spendIn(unitOfWork, key, {
              codeHash: stored.codeHash,
              limit: EMAIL_CODE_GUESS_LIMIT,
            }))
          ) {
            throw emailCodeInvalid();
          }
          if (review) {
            await this.review.admitIn(unitOfWork, claimed, emailCodeInvalid);
          }
        },
        refuse: emailCodeInvalid,
        creationMethod: ACCOUNT_CREATION_METHOD.EMAIL_CODE,
      },
    );
    return this.attempts.view(completed);
  }

  /**
   * Refuses a wrong code and counts it on the attempt, and a wrong fixed review
   * code on the review account's day as well. While review access is off for
   * the account, the fixed code is wrong whatever was typed.
   */
  private async assertRightGuess(
    guess: {
      attempt: NativeAttempt;
      key: EmailCodeKey;
      stored: StoredEmailCode;
      code: string;
      review: boolean;
    },
    secret: string,
  ): Promise<void> {
    const { attempt, key, stored, code, review } = guess;
    const open = !review || (await this.review.usableFor(attempt));
    const right = await this.hashService.compare(code, stored.codeHash);
    if (open && right) return;
    await this.countWrongGuess(key, attempt.attemptId, secret);
    if (open && review) await this.review.countWrongGuess(attempt);
    throw emailCodeInvalid();
  }

  /** The global switch first, like a route-level feature check, then the application's. */
  private async requireAttempt(
    attemptId: string,
    secret: string,
    phases: NativeAttemptPhase[],
  ): Promise<{ attempt: NativeAttempt; withLink: boolean }> {
    if (this.config.get<boolean>('emailCode.enabled', false) !== true) {
      throw featureDisabled();
    }
    const attempt = await this.attempts.authenticate(attemptId, secret);
    const methods = await this.methods.forClient(attempt.clientId);
    if (methods.capabilities.emailCode !== true) throw featureDisabled();
    if (
      attempt.flow !== NATIVE_ATTEMPT_FLOW.SIGN_IN ||
      !phases.includes(attempt.phase)
    ) {
      throw wrongStage();
    }
    return { attempt, withLink: methods.capabilities.emailLink };
  }

  /** The attempt still commits to this exact code: no resend or link spend since. */
  private committed(attempt: NativeAttempt, stored: StoredEmailCode): boolean {
    return matchesPendingCodeGeneration(
      attempt.details.emailCodeGenerationHash,
      this.review.generationOf(stored),
    );
  }

  private live(stored: StoredEmailCode): boolean {
    return (
      stored.spentAt === null &&
      stored.wrongGuesses < EMAIL_CODE_GUESS_LIMIT &&
      stored.expiresAt.getTime() > this.clock.now().getTime()
    );
  }

  private async countWrongGuess(
    key: EmailCodeKey,
    attemptId: string,
    secret: string,
  ): Promise<void> {
    const guesses = await this.codes.recordWrongGuess(
      key,
      EMAIL_CODE_GUESS_LIMIT,
    );
    if (guesses === null || guesses < EMAIL_CODE_GUESS_LIMIT) return;
    for (let pass = 1; pass <= END_ATTEMPT_PASSES; pass += 1) {
      try {
        await this.attempts.cancel(attemptId, secret);
        return;
      } catch (error) {
        if (!(error instanceof AppException)) throw error;
      }
    }
    // The code is already spent, so this attempt can never pass by code.
    this.logger.warn('Email code attempt ran out of guesses but stayed open');
  }
}

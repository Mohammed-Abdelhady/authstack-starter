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
import {
  hashPendingCodeGeneration,
  matchesPendingCodeGeneration,
} from '../../utils/pending-code-generation.util';
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
    if (!(await this.hashService.compare(code, stored.codeHash))) {
      await this.countWrongGuess(key, attemptId, secret);
      throw emailCodeInvalid();
    }
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
        },
        refuse: emailCodeInvalid,
        creationMethod: ACCOUNT_CREATION_METHOD.EMAIL_CODE,
      },
    );
    return this.attempts.view(completed);
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
      hashPendingCodeGeneration(stored.codeHash),
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

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { HashService } from '../../../common/services/hash.service';
import { currentRequestId } from '../../../common/context/request-context';
import { EMAIL_CODE_EXPIRES_IN_DEFAULT } from '../../../config/constants/host-contracts';
import { MailService } from '../../../mail/mail.service';
import { MailDispatcherService } from '../../../mail/mail-dispatcher.service';
import { buildSignInCodeMail } from '../../../mail/builders/sign-in-code';
import type { SignInCodeMail } from '../../../mail/builders/sign-in-code';
import type { MailRecipient } from '../../../mail/types/mail-recipient.types';
import { SIGN_IN_LINK_EMAIL_FAILED_MESSAGE } from '../../constants/auth-messages';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import { AccountCreationPolicy } from '../../services/registration/account-creation-policy';
import { nativeSignUpOpen } from './native-sign-up-open';
import { MagicLinkAccounts } from '../../magic-link/stores/magic-link-accounts';
import { MagicLinkStore } from '../../magic-link/stores/magic-link.store';
import { MAGIC_LINK_RATE_WINDOW_MS } from '../../magic-link/constants/magic-link.constants';
import {
  createMagicLinkToken,
  hashMagicLinkToken,
} from '../../magic-link/utils/magic-link-token.util';
import {
  EMAIL_CODE_PURPOSE,
  EmailCodeStore,
} from '../../pending-codes/email-code.store';
import { generateVerificationCode } from '../../utils/verification-code.util';
import { NATIVE_EMAIL_CALLBACK_PARAM } from '../constants/native-lifecycle.constants';
import type { NativeAttempt } from '../types/native-attempt';
import { mailedCodeMinutes } from './email-code-minutes';
import { NativeEmailCodeReviewService } from './native-email-code-review.service';

/** Immediate resends of one mail before the dispatcher logs it as failed. */
const SIGN_IN_CODE_MAIL_SENDS = 3;

/** What one request leaves to commit on the attempt, and the mail to start after. */
export interface IssuedEmailCode {
  generationHash: string;
  tokenHash: string | null;
  deliver: (() => void) | null;
}

@Injectable()
export class NativeEmailCodeMailService {
  private readonly logger = new Logger(NativeEmailCodeMailService.name);

  constructor(
    private readonly links: MagicLinkStore,
    private readonly accounts: MagicLinkAccounts,
    private readonly codes: EmailCodeStore,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly dispatcher: MailDispatcherService,
    private readonly hashService: HashService,
    private readonly policy: AccountCreationPolicy,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
    private readonly review: NativeEmailCodeReviewService,
  ) {}

  /**
   * Stores a code, and a link token when asked, for this attempt alone. Every
   * branch hashes and stores a code, so the reply never tells a known address
   * from an unknown, closed, capped or deactivated one. A deactivated account
   * is mailed like any other, and only its right code learns of the
   * deactivation. A code that will not be mailed is stored already spent. The
   * review account on its application gets the fixed code stored instead, and
   * no mail.
   */
  async issue(
    requested: MailRecipient,
    attempt: NativeAttempt,
    withLink: boolean,
  ): Promise<IssuedEmailCode> {
    const { email } = requested;
    const now = this.clock.now();
    const owner = await this.accounts.findLinkRecipient(email);
    // Asked for every address, so an unknown one costs no extra transaction.
    const signUpOpen = await nativeSignUpOpen(
      this.runner,
      this.policy,
      attempt.clientId,
      ACCOUNT_CREATION_METHOD.EMAIL_CODE,
    );
    const mayCreate = owner !== null || signUpOpen;
    const underCap = await this.links.takeRequestSlot(email, {
      now,
      windowMs: MAGIC_LINK_RATE_WINDOW_MS,
      limit: this.config.get<number>('magicLink.maxPerHour', 5),
    });
    const reviewHash = await this.review.codeHashFor(attempt, email);
    const mailed = reviewHash === null && mayCreate && underCap;
    const code = generateVerificationCode();
    const token = withLink ? createMagicLinkToken() : null;
    const lifetimeMs = this.config.get<number>(
      'emailCode.expiresIn',
      EMAIL_CODE_EXPIRES_IN_DEFAULT,
    );
    const expiresAt = new Date(
      Math.min(now.getTime() + lifetimeMs, attempt.expiresAt.getTime()),
    );
    // Hashed on every branch, the review one too, so each costs the same.
    const codeHash = await this.hashService.hash(code);
    const stored = await this.codes.put({
      ownerId: attempt.attemptId,
      purpose: EMAIL_CODE_PURPOSE.SIGN_IN,
      email,
      codeHash: reviewHash ?? codeHash,
      expiresAt,
      purgeAfter: attempt.expiresAt,
      // Past the mail limit the fixed code is stored spent like any other.
      spent: reviewHash === null ? !mailed : !underCap,
    });
    if (!mailed) {
      this.logger.warn(
        this.unsentReason(mayCreate, reviewHash !== null && underCap),
      );
    }
    const recipient = { email, locale: owner?.locale ?? requested.locale };
    const mail: SignInCodeMail = {
      locale: recipient.locale,
      code,
      expiresInMinutes: mailedCodeMinutes(
        expiresAt.getTime() - now.getTime(),
        lifetimeMs,
      ),
      link: token ? nativeCodeCallback(attempt, token) : null,
    };
    return {
      generationHash: this.review.generationOf(stored),
      tokenHash: token ? hashMagicLinkToken(token) : null,
      deliver: mailed ? () => this.deliver(recipient, mail) : null,
    };
  }

  private unsentReason(mayCreate: boolean, review: boolean): string {
    const requestId = currentRequestId() ?? 'unknown';
    if (review) {
      return `Sign-in code not mailed: review access requestId=${requestId}`;
    }
    if (!mayCreate) {
      return `Sign-in code not mailed: sign-up closed requestId=${requestId}`;
    }
    return `Sign-in code not mailed: address cap reached requestId=${requestId}`;
  }

  private deliver(recipient: MailRecipient, mail: SignInCodeMail): void {
    this.dispatcher.dispatch(async () => {
      const content = buildSignInCodeMail(mail);
      for (let send = 1; send <= SIGN_IN_CODE_MAIL_SENDS; send += 1) {
        try {
          await this.mail.sendMail({ to: recipient.email, ...content });
          return;
        } catch (error) {
          if (send === SIGN_IN_CODE_MAIL_SENDS) throw error;
        }
      }
    }, SIGN_IN_LINK_EMAIL_FAILED_MESSAGE);
  }
}

/** Parameters after `#`, so a browser that opens it without the app sends none to a server. */
function nativeCodeCallback(attempt: NativeAttempt, token: string): string {
  const callback = new URL(attempt.redirectUri);
  callback.hash = new URLSearchParams([
    [NATIVE_EMAIL_CALLBACK_PARAM.ATTEMPT_ID, attempt.attemptId],
    [NATIVE_EMAIL_CALLBACK_PARAM.EMAIL_TOKEN, token],
    [NATIVE_EMAIL_CALLBACK_PARAM.STATE, attempt.state],
  ]).toString();
  return callback.toString();
}

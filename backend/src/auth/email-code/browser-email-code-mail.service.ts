import { createMagicLinkToken } from '../magic-link/utils/magic-link-token.util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../common/services/clock';
import { HashService } from '../../common/services/hash.service';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { EMAIL_CODE_EXPIRES_IN_DEFAULT } from '../../config/constants/host-contracts';
import { MailService } from '../../mail/mail.service';
import { MailDispatcherService } from '../../mail/mail-dispatcher.service';
import { buildSignInCodeMail } from '../../mail/builders/sign-in-code';
import type { MailRecipient } from '../../mail/types/mail-recipient.types';
import { ACCOUNT_CREATION_METHOD } from '../constants/account-creation';
import { SIGN_IN_LINK_EMAIL_FAILED_MESSAGE } from '../constants/auth-messages';
import { MagicLinkAccounts } from '../magic-link/stores/magic-link-accounts';
import { MagicLinkStore } from '../magic-link/stores/magic-link.store';
import { MAGIC_LINK_RATE_WINDOW_MS } from '../magic-link/constants/magic-link.constants';
import { nativeSignUpOpen } from '../native/lifecycle/native-sign-up-open';
import { NativeEmailCodeCeilingService } from '../native/lifecycle/native-email-code-ceiling.service';
import { mailedCodeMinutes } from '../native/lifecycle/email-code-minutes';
import {
  EmailCodeStore,
  EMAIL_CODE_GUESS_LIMIT,
  type EmailCodeKey,
  type StoredEmailCode,
} from '../pending-codes/email-code.store';
import { AccountCreationPolicy } from '../services/registration/account-creation-policy';
import { generateVerificationCode } from '../utils/verification-code.util';

const MAIL_SENDS = 3;

export interface BrowserEmailCodeMailServiceDependencies {
  accounts: MagicLinkAccounts;
  links: MagicLinkStore;
  codes: EmailCodeStore;
  config: ConfigService;
  hash: HashService;
  clock: Clock;
  policy: AccountCreationPolicy;
  runner: UnitOfWorkRunner;
  ceiling: NativeEmailCodeCeilingService;
  dispatcher: MailDispatcherService;
  mail: MailService;
}

@Injectable()
export class BrowserEmailCodeMailService {
  constructor(
    private readonly dependencies: BrowserEmailCodeMailServiceDependencies,
  ) {}

  async issue(
    key: EmailCodeKey,
    requested: MailRecipient,
    clientId: string,
  ): Promise<void> {
    const owner = await this.dependencies.accounts.findLinkRecipient(
      requested.email,
    );
    const signUpOpen = await nativeSignUpOpen(
      this.dependencies.runner,
      this.dependencies.policy,
      clientId,
      ACCOUNT_CREATION_METHOD.EMAIL_CODE,
    );
    const now = this.dependencies.clock.now();
    const underCap = await this.dependencies.links.takeRequestSlot(
      requested.email,
      {
        now,
        windowMs: MAGIC_LINK_RATE_WINDOW_MS,
        limit: this.dependencies.config.get<number>('magicLink.maxPerHour', 5),
      },
    );
    const pastCeiling = await this.dependencies.ceiling.reachedFor(
      requested.email,
    );
    const mailed = (owner !== null || signUpOpen) && underCap && !pastCeiling;
    const code = generateVerificationCode();
    const lifetimeMs = this.dependencies.config.get<number>(
      'emailCode.expiresIn',
      EMAIL_CODE_EXPIRES_IN_DEFAULT,
    );
    const expiresAt = new Date(now.getTime() + lifetimeMs);
    const codeHash = await this.dependencies.hash.hash(code);
    const stored = await this.dependencies.codes.put({
      ...key,
      email: requested.email,
      codeHash: `pending:${createMagicLinkToken()}`,
      expiresAt,
      purgeAfter: expiresAt,
      spent: true,
    });
    if (!mailed) return;
    const recipient = {
      ...requested,
      locale: owner?.locale ?? requested.locale,
    };
    const content = buildSignInCodeMail({
      locale: recipient.locale,
      code,
      link: null,
      expiresInMinutes: mailedCodeMinutes(lifetimeMs, lifetimeMs),
    });
    this.deliver({ stored, codeHash, recipient, content });
  }

  private deliver(delivery: {
    stored: StoredEmailCode;
    codeHash: string;
    recipient: MailRecipient;
    content: ReturnType<typeof buildSignInCodeMail>;
  }): void {
    this.dependencies.dispatcher.dispatch(async () => {
      await this.send(delivery.recipient, delivery.content);
      await this.dependencies.runner.run((work) =>
        this.dependencies.codes.deliverIn(work, delivery.stored, {
          pendingHash: delivery.stored.codeHash,
          codeHash: delivery.codeHash,
          limit: EMAIL_CODE_GUESS_LIMIT,
        }),
      );
    }, SIGN_IN_LINK_EMAIL_FAILED_MESSAGE);
  }

  private async send(
    recipient: MailRecipient,
    content: ReturnType<typeof buildSignInCodeMail>,
  ): Promise<void> {
    for (let send = 1; send <= MAIL_SENDS; send += 1) {
      try {
        await this.dependencies.mail.sendMail({
          to: recipient.email,
          ...content,
        });
        return;
      } catch (error) {
        if (send === MAIL_SENDS) throw error;
      }
    }
  }
}

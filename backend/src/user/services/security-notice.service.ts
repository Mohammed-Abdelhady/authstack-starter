import { Injectable, Optional } from '@nestjs/common';
import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { StoredAccount } from '../stores/stored-account';
import type { DeviceParts } from '@app/sdk';
import { currentRequestUserAgent } from '../../common/context/request-context';
import { Clock } from '../../common/services/clock';
import { parseUserAgent } from '../../common/utils/parse-user-agent';
import { MailDispatcherService } from '../../mail/mail-dispatcher.service';
import { MailService } from '../../mail/mail.service';
import { buildSecurityNoticeMail } from '../../mail/builders/security-notice';
import type { MailRecipient } from '../../mail/types/mail-recipient.types';
import { AccountProfileStore } from '../stores/account-profile.store';
import type {
  SecurityNotice,
  SecurityNoticeFacts,
} from '../types/security-notice.type';

/** The device of the request being handled, when it sent a user agent. */
export function requestDevice(): DeviceParts | undefined {
  const userAgent = currentRequestUserAgent();
  return userAgent === undefined ? undefined : parseUserAgent(userAgent).parts;
}

/**
 * Mails security notices in the account's language, after the change that
 * caused them has committed. The mail leaves through the dispatcher, so the
 * answer to the request never waits on SMTP.
 */
@Injectable()
export class SecurityNoticeService {
  constructor(
    private readonly accounts: AccountProfileStore,
    private readonly mail: MailService,
    private readonly dispatcher: MailDispatcherService,
    @Optional() private readonly clock?: Clock,
  ) {}

  afterCommitIn(
    work: UnitOfWork,
    account: Pick<StoredAccount, 'email' | 'locale' | 'isVerified'>,
    notice: SecurityNotice,
  ): void {
    if (!account.isVerified) return;
    const recipient = { email: account.email, locale: account.locale };
    const facts = this.factsNow();
    work.afterCommit(() => this.deferTo(recipient, notice, facts));
  }

  /**
   * For a change that keeps the account and its address. Reads the current
   * verified address when the mail is sent, and skips a deactivated account.
   * The time and the device are taken now, while the request that made the
   * change is still being handled.
   */
  defer(userId: string, notice: SecurityNotice): void {
    const facts = this.factsNow();
    this.dispatcher.dispatch(async () => {
      const account = await this.accounts.findProfile(userId);
      if (!account || account.isDeleted || !account.isVerified) return;
      await this.send(
        { email: account.email, locale: account.locale },
        notice,
        facts,
      );
    }, `Security notice failed: ${notice}`);
  }

  /**
   * Mails the recipient the caller read in the unit of work that committed
   * the change, whatever the account looks like by the time the mail leaves.
   * That is how a notice reaches the address an account just left, or an
   * account that was just deactivated. Facts the caller leaves out are taken
   * now: the time, and the device of the request being handled.
   */
  deferTo(
    recipient: MailRecipient,
    notice: SecurityNotice,
    facts: Partial<SecurityNoticeFacts> = {},
  ): void {
    const now = this.factsNow();
    const fixed: SecurityNoticeFacts = { ...now, ...definedFacts(facts) };
    this.dispatcher.dispatch(
      () => this.send(recipient, notice, fixed),
      `Security notice failed: ${notice}`,
    );
  }

  private send(
    recipient: MailRecipient,
    notice: SecurityNotice,
    facts: SecurityNoticeFacts,
  ): Promise<void> {
    const content = buildSecurityNoticeMail(recipient.locale, notice, facts);
    return this.mail.sendMail({ to: recipient.email, ...content });
  }

  private factsNow(): SecurityNoticeFacts {
    const at = this.clock?.now() ?? new Date();
    const device = requestDevice();
    return device === undefined ? { at } : { at, device };
  }
}

/** The facts a caller did give, so an absent one never hides the default. */
function definedFacts(
  facts: Partial<SecurityNoticeFacts>,
): Partial<SecurityNoticeFacts> {
  return {
    ...(facts.at === undefined ? {} : { at: facts.at }),
    ...(facts.device === undefined ? {} : { device: facts.device }),
  };
}

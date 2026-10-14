import { Injectable } from '@nestjs/common';
import { MailDispatcherService } from '../../mail/mail-dispatcher.service';
import { MailService } from '../../mail/mail.service';
import { AccountProfileStore } from '../stores/account-profile.store';

import type { SecurityNotice } from '../types/security-notice.type';

/**
 * Reads the current verified address after a security change commits, and
 * mails the notice in the account's language.
 */
@Injectable()
export class SecurityNoticeService {
  constructor(
    private readonly accounts: AccountProfileStore,
    private readonly mail: MailService,
    private readonly dispatcher: MailDispatcherService,
  ) {}

  defer(userId: string, notice: SecurityNotice): void {
    this.dispatcher.dispatch(async () => {
      const account = await this.accounts.findProfile(userId);
      if (!account || account.isDeleted || !account.isVerified) return;
      await this.mail.sendSecurityNotice(
        { email: account.email, locale: account.locale },
        notice,
      );
    }, `Security notice failed: ${notice}`);
  }
}

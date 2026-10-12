import { Injectable } from '@nestjs/common';
import { MailDispatcherService } from '../../mail/mail-dispatcher.service';
import { MailService } from '../../mail/mail.service';
import { AccountProfileStore } from '../stores/account-profile.store';

import type { SecurityNotice } from '../types/security-notice.type';
import { SECURITY_NOTICE_MESSAGES } from '../constants/security-notice.constants';

/** Reads the current verified address after a security change commits. */
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
      await this.mail.sendMail({
        to: account.email,
        ...SECURITY_NOTICE_MESSAGES[notice],
      });
    }, `Security notice failed: ${notice}`);
  }
}

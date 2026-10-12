import { Injectable } from '@nestjs/common';
import { MailDispatcherService } from '../../mail/mail-dispatcher.service';
import { MailService } from '../../mail/mail.service';
import { AccountProfileStore } from '../stores/account-profile.store';

import type { SecurityNotice } from '../types/security-notice.type';

const NOTICE_TEXT: Record<SecurityNotice, { subject: string; text: string }> = {
  password_reset: {
    subject: 'Your password was reset',
    text: 'The password for your account was reset. If this was not you, contact support immediately.',
  },
  password_changed: {
    subject: 'Your password was changed',
    text: 'The password for your account was changed. If this was not you, contact support immediately.',
  },
  two_factor_disabled: {
    subject: 'Two-factor authentication was disabled',
    text: 'Two-factor authentication was disabled on your account. If this was not you, contact support immediately.',
  },
  passkey_added: {
    subject: 'A passkey was added',
    text: 'A passkey was added to your account. If this was not you, contact support immediately.',
  },
  provider_added: {
    subject: 'A sign-in provider was added',
    text: 'A sign-in provider was linked to your account. If this was not you, contact support immediately.',
  },
};

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
      await this.mail.sendMail({ to: account.email, ...NOTICE_TEXT[notice] });
    }, `Security notice failed: ${notice}`);
  }
}

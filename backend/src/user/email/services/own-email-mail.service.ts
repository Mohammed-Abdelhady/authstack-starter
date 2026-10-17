import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ACTIVATION_CODE_EXPIRES_IN_DEFAULT } from '../../../auth/constants/registration';
import { EMAIL_CHANGE_EMAIL_FAILED_MESSAGE } from '../../../auth/constants/auth-messages';
import { buildOwnEmailChangeCodeMail } from '../../../mail/builders/own-email-change-code';
import { MS_PER_MINUTE } from '../../../mail/constants/mail.constants';
import { MailDispatcherService } from '../../../mail/mail-dispatcher.service';
import { MailService } from '../../../mail/mail.service';
import type { MailRecipient } from '../../../mail/types/mail-recipient.types';

/**
 * Mails the code for an address the account holder asked for. The send leaves
 * through the dispatcher, so the answer never waits on SMTP and a delivery
 * failure cannot tell a free address from a held one.
 */
@Injectable()
export class OwnEmailMailService {
  private readonly expiresInMinutes: number;

  constructor(
    private readonly mail: MailService,
    private readonly dispatcher: MailDispatcherService,
    configService: ConfigService,
  ) {
    // Rounded down, so the mail never promises more time than the code has.
    this.expiresInMinutes = Math.floor(
      configService.get<number>(
        'activation.codeExpiresIn',
        ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
      ) / MS_PER_MINUTE,
    );
  }

  deferCode(recipient: MailRecipient, code: string): void {
    const content = buildOwnEmailChangeCodeMail({
      locale: recipient.locale,
      code,
      expiresInMinutes: this.expiresInMinutes,
    });
    this.dispatcher.dispatch(
      () => this.mail.sendMail({ to: recipient.email, ...content }),
      EMAIL_CHANGE_EMAIL_FAILED_MESSAGE,
    );
  }
}

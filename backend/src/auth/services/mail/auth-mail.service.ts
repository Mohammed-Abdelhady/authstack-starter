import { Injectable, Logger } from '@nestjs/common';
import { MailService } from '../../../mail/mail.service';
import { MailDispatcherService } from '../../../mail/mail-dispatcher.service';
import type { MailRecipient } from '../../../mail/types/mail-recipient.types';
import { currentRequestId } from '../../../common/context/request-context';
import {
  ACTIVATION_EMAIL_FAILED_MESSAGE,
  EMAIL_CHANGE_EMAIL_FAILED_MESSAGE,
  EMAIL_CHANGE_NOTICE_FAILED_MESSAGE,
  PASSWORD_RESET_EMAIL_FAILED_MESSAGE,
  REGISTRATION_NOTICE_EMAIL_FAILED_MESSAGE,
  SIGN_IN_LINK_EMAIL_FAILED_MESSAGE,
} from '../../constants/auth-messages';

/**
 * Anonymous mail leaves through the dispatcher, so the response never waits on
 * SMTP; admin mail is awaited because the admin's answer depends on it. A
 * delivery failure is logged and dropped, so a known and an unknown address
 * get the same answer.
 */
@Injectable()
export class AuthMailService {
  private readonly logger = new Logger(AuthMailService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly dispatcher: MailDispatcherService,
  ) {}

  /**
   * Start an activation code email for an anonymous caller. The greeting is
   * neutral: no name is stored before the address is proved.
   *
   * @param recipient - Address with no account yet, and the request's language
   * @param code - 6-digit activation code
   */
  deferActivationCode(recipient: MailRecipient, code: string): void {
    this.dispatcher.dispatch(
      () => this.mailService.sendActivationCode(recipient, code),
      ACTIVATION_EMAIL_FAILED_MESSAGE,
    );
  }

  /**
   * Start a password reset code email for an anonymous caller.
   *
   * @param recipient - Account address and its stored language
   * @param code - 6-digit reset code
   * @param name - Account holder name
   */
  deferPasswordResetCode(
    recipient: MailRecipient,
    code: string,
    name: string,
  ): void {
    this.dispatcher.dispatch(
      () => this.mailService.sendPasswordResetCode(recipient, code, name),
      PASSWORD_RESET_EMAIL_FAILED_MESSAGE,
    );
  }

  /**
   * Start a registration-attempt notice for an anonymous caller.
   *
   * @param recipient - Account address and its stored language
   * @param name - Account holder name
   */
  deferRegistrationAttemptNotice(recipient: MailRecipient, name: string): void {
    this.dispatcher.dispatch(
      () => this.mailService.sendRegistrationAttemptNotice(recipient, name),
      REGISTRATION_NOTICE_EMAIL_FAILED_MESSAGE,
    );
  }

  /**
   * Mail a one-time sign-in link.
   *
   * @param recipient - Address, in the account's language or the request's
   * @param link - Client URL carrying the token
   * @param expiresInMinutes - Minutes until the link stops working
   */
  async sendMagicLink(
    recipient: MailRecipient,
    link: string,
    expiresInMinutes: number,
  ): Promise<boolean> {
    return this.send(
      () => this.mailService.sendMagicLink(recipient, link, expiresInMinutes),
      SIGN_IN_LINK_EMAIL_FAILED_MESSAGE,
    );
  }

  /**
   * Mail the code that confirms a new address an admin moved an account to.
   * Awaited: the admin's answer depends on the mail being handed over.
   *
   * @param recipient - New address, in the account's language
   * @param code - 6-digit confirmation code
   */
  async sendEmailChangeCode(
    recipient: MailRecipient,
    code: string,
  ): Promise<boolean> {
    return this.send(
      () => this.mailService.sendEmailChangeCode(recipient, code),
      EMAIL_CHANGE_EMAIL_FAILED_MESSAGE,
    );
  }

  /** Queue notice mail to the address that remains active during confirmation. */
  deferEmailChangeNotice(recipient: MailRecipient): void {
    this.dispatcher.dispatch(
      () => this.mailService.sendEmailChangeNotice(recipient),
      EMAIL_CHANGE_NOTICE_FAILED_MESSAGE,
    );
  }

  /** True when the mail was handed over, false when a failure was dropped. */
  private async send(
    action: () => Promise<void>,
    failureMessage: string,
  ): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (error) {
      const requestId = currentRequestId() ?? 'unknown';
      const cause = error instanceof Error ? error.name : typeof error;
      this.logger.error(
        `${failureMessage} requestId=${requestId} cause=${cause}`,
      );
      return false;
    }
  }
}

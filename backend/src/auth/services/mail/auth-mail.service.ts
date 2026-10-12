import { Injectable, Logger } from '@nestjs/common';
import { MailService } from '../../../mail/mail.service';
import { MailDispatcherService } from '../../../mail/mail-dispatcher.service';
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
   * @param email - Recipient address
   * @param code - 6-digit activation code
   */
  deferActivationCode(email: string, code: string): void {
    this.dispatcher.dispatch(
      () => this.mailService.sendActivationCode(email, code),
      ACTIVATION_EMAIL_FAILED_MESSAGE,
    );
  }

  /**
   * Start a password reset code email for an anonymous caller.
   *
   * @param email - Recipient address
   * @param code - 6-digit reset code
   * @param name - Account holder name
   */
  deferPasswordResetCode(email: string, code: string, name: string): void {
    this.dispatcher.dispatch(
      () => this.mailService.sendPasswordResetCode(email, code, name),
      PASSWORD_RESET_EMAIL_FAILED_MESSAGE,
    );
  }

  /**
   * Start a registration-attempt notice for an anonymous caller.
   *
   * @param email - Recipient address
   * @param name - Account holder name
   */
  deferRegistrationAttemptNotice(email: string, name: string): void {
    this.dispatcher.dispatch(
      () => this.mailService.sendRegistrationAttemptNotice(email, name),
      REGISTRATION_NOTICE_EMAIL_FAILED_MESSAGE,
    );
  }

  /**
   * Mail a one-time sign-in link.
   *
   * @param email - Recipient address
   * @param link - Client URL carrying the token
   * @param expiresInMinutes - Minutes until the link stops working
   */
  async sendMagicLink(
    email: string,
    link: string,
    expiresInMinutes: number,
  ): Promise<boolean> {
    return this.send(
      () => this.mailService.sendMagicLink(email, link, expiresInMinutes),
      SIGN_IN_LINK_EMAIL_FAILED_MESSAGE,
    );
  }

  /**
   * Mail the code that confirms a new address an admin moved an account to.
   * Awaited: the admin's answer depends on the mail being handed over.
   *
   * @param email - New address
   * @param code - 6-digit confirmation code
   */
  async sendEmailChangeCode(email: string, code: string): Promise<boolean> {
    return this.send(
      () => this.mailService.sendEmailChangeCode(email, code),
      EMAIL_CHANGE_EMAIL_FAILED_MESSAGE,
    );
  }

  /** Queue notice mail to the address that remains active during confirmation. */
  deferEmailChangeNotice(email: string): void {
    this.dispatcher.dispatch(
      () => this.mailService.sendEmailChangeNotice(email),
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

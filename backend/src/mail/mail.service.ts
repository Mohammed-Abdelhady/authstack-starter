import { buildInvitationMail } from './builders/invitation'; // feature:invitations
import { buildPasskeyResetMail } from './builders/passkey-reset'; // feature:invitations
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailOptions } from './interfaces/mail-options.interface';
import { currentRequestId } from '../common/context/request-context';
import {
  MAIL_CONNECTION_TIMEOUT_MS,
  MAIL_GREETING_TIMEOUT_MS,
  MAIL_POOL_MAX_CONNECTIONS,
  MAIL_POOL_MAX_MESSAGES,
  MAIL_SOCKET_TIMEOUT_MS,
  MS_PER_MINUTE,
} from './constants/mail.constants';
import { MAIL_NAME } from './constants/mail-names';
import type { MailContent } from './types/mail-catalogue.types';
import type { MailRecipient } from './types/mail-recipient.types';
import { mailLink } from './links/mail-links';
import { buildActivationCodeMail } from './builders/activation-code';
import { buildEmailChangeCodeMail } from './builders/email-change-code';
import { buildEmailChangeNoticeMail } from './builders/email-change-notice';
import { buildPasswordResetCodeMail } from './builders/password-reset-code';
import { buildMagicLinkMail } from './builders/magic-link';
import { buildRegistrationNoticeMail } from './builders/registration-notice';
import { buildSecurityNoticeMail } from './builders/security-notice';
import type { SecurityNotice } from '../user/types/security-notice.type';
import type { FreshProofSender } from '../auth/contracts/fresh-proof';
import type { FreshProofMail } from '../auth/contracts/types/fresh-proof';
import { buildProofCodeMail } from './builders/proof-code';

/** Default code lifetime in milliseconds, matching the activation default. */
const DEFAULT_CODE_EXPIRES_IN_MS = 900000;

/**
 * Sends each mail in the recipient's language. The copy lives in the
 * catalogue and each mail's layout in its builder; this service reads the
 * configuration a mail needs and hands the result to SMTP.
 */
@Injectable()
export class MailService implements FreshProofSender {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    const secure = this.configService.get<boolean>('smtp.secure', false);
    const production =
      this.configService.get<string>('NODE_ENV') === 'production';
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('smtp.host'),
      port: this.configService.get<number>('smtp.port'),
      secure,
      // Without implicit TLS a relay that offers no STARTTLS would be sent
      // codes and links in clear text. In production the send fails instead.
      requireTLS: production && !secure,
      auth: {
        user: this.configService.get<string>('smtp.user'),
        pass: this.configService.get<string>('smtp.pass'),
      },
      // nodemailer's SMTP transport supports pooling, so deferred sends share
      // connections instead of each holding one open.
      pool: true,
      maxConnections: MAIL_POOL_MAX_CONNECTIONS,
      maxMessages: MAIL_POOL_MAX_MESSAGES,
      // Each send is bounded, so a stalling server cannot hold the pool.
      connectionTimeout: MAIL_CONNECTION_TIMEOUT_MS,
      greetingTimeout: MAIL_GREETING_TIMEOUT_MS,
      socketTimeout: MAIL_SOCKET_TIMEOUT_MS,
    });
  }

  /** Close the pooled transporter. Safe on a double without a live pool. */
  closeTransport(): void {
    this.transporter?.close();
  }

  /**
   * Minutes a code lives, rendered from the configured lifetime. Rounded down
   * so the mail never promises more time than the code has.
   */
  private codeExpiresInMinutes(): number {
    const expiresInMs = this.configService.get<number>(
      'activation.codeExpiresIn',
      DEFAULT_CODE_EXPIRES_IN_MS,
    );
    return Math.floor(expiresInMs / MS_PER_MINUTE);
  }

  /**
   * Send an email using the configured SMTP server
   * @param options - Mail options including recipient, subject, and content
   * @throws Error if SMTP configuration is missing or sending fails
   */
  async sendMail(options: MailOptions): Promise<void> {
    const from = this.configService.get<string>('smtp.from');

    if (!from) {
      throw new Error('EMAIL_FROM environment variable is not configured');
    }

    try {
      await this.transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      this.logger.log(
        `Email sent: subject=${options.subject} requestId=${currentRequestId() ?? 'unknown'}`,
      );
    } catch (error) {
      const cause = error instanceof Error ? error.name : typeof error;
      this.logger.error(
        `Failed to send email: subject=${options.subject} requestId=${currentRequestId() ?? 'unknown'} cause=${cause}`,
      );
      throw new Error(
        `Failed to send email: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private send(recipient: MailRecipient, content: MailContent): Promise<void> {
    return this.sendMail({ to: recipient.email, ...content });
  }

  /** Core action proof. Plan 4 supplies the issuer; no route calls this yet. */
  async sendProofCode(mail: FreshProofMail): Promise<void> {
    await this.send(mail.recipient, buildProofCodeMail(mail));
  }

  /** The sign-up code, to an address that has no account yet. */
  async sendActivationCode(
    recipient: MailRecipient,
    code: string,
  ): Promise<void> {
    await this.send(
      recipient,
      buildActivationCodeMail({
        locale: recipient.locale,
        code,
        expiresInMinutes: this.codeExpiresInMinutes(),
      }),
    );
  }

  /** The code and link that confirm a new address an admin moved an account to. */
  async sendEmailChangeCode(
    recipient: MailRecipient,
    code: string,
  ): Promise<void> {
    await this.send(
      recipient,
      buildEmailChangeCodeMail({
        locale: recipient.locale,
        code,
        expiresInMinutes: this.codeExpiresInMinutes(),
        confirmUrl: mailLink(
          this.configService,
          MAIL_NAME.EMAIL_CHANGE_CODE,
          recipient,
        ),
      }),
    );
  }

  /** Notify the current mailbox that an admin requested an address change. */
  async sendEmailChangeNotice(recipient: MailRecipient): Promise<void> {
    await this.send(recipient, buildEmailChangeNoticeMail(recipient.locale));
  }

  async sendPasswordResetCode(
    recipient: MailRecipient,
    code: string,
    name: string,
  ): Promise<void> {
    await this.send(
      recipient,
      buildPasswordResetCodeMail({
        locale: recipient.locale,
        code,
        name,
        expiresInMinutes: this.codeExpiresInMinutes(),
      }),
    );
  }

  /**
   * A one-time sign-in link. The caller builds the link: the web page's from
   * the link templates, a native app's from its registered callback.
   */
  async sendMagicLink(
    recipient: MailRecipient,
    link: string,
    expiresInMinutes: number,
  ): Promise<void> {
    await this.send(
      recipient,
      buildMagicLinkMail({ locale: recipient.locale, link, expiresInMinutes }),
    );
  }

  /**
   * Tell an account holder that their address was used in a registration.
   * Sent instead of an activation code, so registration answers the same way
   * for an address that has an account and one that does not.
   */
  async sendRegistrationAttemptNotice(
    recipient: MailRecipient,
    name: string,
  ): Promise<void> {
    await this.send(
      recipient,
      buildRegistrationNoticeMail({ locale: recipient.locale, name }),
    );
  }

  /** Tell an account holder that a security change was made on the account. */
  async sendSecurityNotice(
    recipient: MailRecipient,
    notice: SecurityNotice,
  ): Promise<void> {
    await this.send(
      recipient,
      buildSecurityNoticeMail(recipient.locale, notice),
    );
  }
  // feature:invitations:start
  async sendInvitation(
    recipient: MailRecipient,
    link: string,
    expiresInDays: number,
    inviterName?: string,
  ): Promise<void> {
    await this.send(
      recipient,
      buildInvitationMail({
        locale: recipient.locale,
        link,
        expiresInDays,
        inviterName,
      }),
    );
  }

  async sendPasskeyReset(
    recipient: MailRecipient,
    link: string,
    expiresInDays: number,
  ): Promise<void> {
    await this.send(
      recipient,
      buildPasskeyResetMail({ locale: recipient.locale, link, expiresInDays }),
    );
  }
  // feature:invitations:end
}

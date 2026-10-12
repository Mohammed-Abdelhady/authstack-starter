import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailOptions } from './interfaces/mail-options.interface';
import { escapeHtml } from '../common/utils/escape-html';
import { buildClientUrl } from '../common/utils/client-url.util';
import { currentRequestId } from '../common/context/request-context';
import {
  ACTIVATION_BODY_TEXT,
  ACTIVATION_EMAIL_SUBJECT,
  codeExpirySentence,
  EMAIL_CHANGE_BODY_TEXT,
  EMAIL_CHANGE_CONFIRM_PATH,
  EMAIL_CHANGE_EMAIL_SUBJECT,
  EMAIL_CHANGE_NOTICE_BODY_TEXT,
  EMAIL_CHANGE_NOTICE_SUBJECT,
  magicLinkExpirySentence,
  MAGIC_LINK_EMAIL_SUBJECT,
  MAIL_CONNECTION_TIMEOUT_MS,
  MAIL_GREETING_TIMEOUT_MS,
  MAIL_POOL_MAX_CONNECTIONS,
  MAIL_POOL_MAX_MESSAGES,
  MAIL_SOCKET_TIMEOUT_MS,
  MS_PER_MINUTE,
  NEUTRAL_GREETING,
  PASSWORD_RESET_EMAIL_SUBJECT,
  REGISTRATION_NOTICE_EMAIL_SUBJECT,
} from './constants/mail.constants';

/** Default code lifetime in milliseconds, matching the activation default. */
const DEFAULT_CODE_EXPIRES_IN_MS = 900000;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('smtp.host'),
      port: this.configService.get<number>('smtp.port'),
      secure: this.configService.get<boolean>('smtp.secure', false),
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
      throw new Error('SMTP_FROM environment variable is not configured');
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

  /**
   * Send an activation code email. The greeting is neutral: no name is stored
   * before the address is proved, so none can be shown.
   * Values that come from user input are escaped before they reach the HTML.
   * @param email - Recipient email address
   * @param code - 6-digit activation code
   */
  async sendActivationCode(email: string, code: string): Promise<void> {
    const safeCode = escapeHtml(code);
    const expiresInMinutes = this.codeExpiresInMinutes();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Email</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Verify Your Email Address</h2>
            <p>${NEUTRAL_GREETING}</p>
            <p>Thank you for registering! ${ACTIVATION_BODY_TEXT}</p>
            <div style="background-color: #f5f5f5; padding: 20px; text-align: center; border-radius: 5px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #007bff;">${safeCode}</span>
            </div>
            <p>${codeExpirySentence(expiresInMinutes)}</p>
            <p>If you didn't request this code, you can safely ignore this email.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        </body>
      </html>
    `;

    const text = `${NEUTRAL_GREETING}\n\nThank you for registering! ${ACTIVATION_BODY_TEXT}\n\n${code}\n\n${codeExpirySentence(expiresInMinutes)}\n\nIf you didn't request this code, you can safely ignore this email.\n\nBest regards,\nThe Team`;

    await this.sendMail({
      to: email,
      subject: ACTIVATION_EMAIL_SUBJECT,
      html,
      text,
    });
  }

  /**
   * Send the code that confirms a new address an admin moved an account to.
   * The copy names the change and links to the confirmation page, so it is not
   * mistaken for a sign-up code. The link carries no address and no code.
   * @param email - New address the code is sent to
   * @param code - 6-digit confirmation code
   */
  async sendEmailChangeCode(email: string, code: string): Promise<void> {
    const safeCode = escapeHtml(code);
    const expiresInMinutes = this.codeExpiresInMinutes();
    const confirmUrl = buildClientUrl(
      this.configService,
      EMAIL_CHANGE_CONFIRM_PATH,
    );
    const safeConfirmUrl = escapeHtml(confirmUrl);
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Confirm Your New Email</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Confirm Your New Email Address</h2>
            <p>${NEUTRAL_GREETING}</p>
            <p>${EMAIL_CHANGE_BODY_TEXT}</p>
            <div style="background-color: #f5f5f5; padding: 20px; text-align: center; border-radius: 5px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #007bff;">${safeCode}</span>
            </div>
            <div style="margin: 20px 0;">
              <a href="${safeConfirmUrl}" style="background-color: #007bff; color: #ffffff; padding: 12px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Confirm the new address</a>
            </div>
            <p>If the button does not work, paste this address into your browser:</p>
            <p style="word-break: break-all; color: #555;">${safeConfirmUrl}</p>
            <p>${codeExpirySentence(expiresInMinutes)}</p>
            <p>If you didn't expect this change, contact your administrator.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        </body>
      </html>
    `;

    const text = `${NEUTRAL_GREETING}\n\n${EMAIL_CHANGE_BODY_TEXT}\n\n${confirmUrl}\n\nCode: ${code}\n\n${codeExpirySentence(expiresInMinutes)}\n\nIf you didn't expect this change, contact your administrator.\n\nBest regards,\nThe Team`;

    await this.sendMail({
      to: email,
      subject: EMAIL_CHANGE_EMAIL_SUBJECT,
      html,
      text,
    });
  }

  /** Notify the current mailbox that an admin requested an address change. */
  async sendEmailChangeNotice(email: string): Promise<void> {
    const text = `${NEUTRAL_GREETING}\n\n${EMAIL_CHANGE_NOTICE_BODY_TEXT}\n\nBest regards,\nThe Team`;
    const html = `<!DOCTYPE html><html><body><p>${NEUTRAL_GREETING}</p><p>${EMAIL_CHANGE_NOTICE_BODY_TEXT}</p><p>Best regards,<br>The Team</p></body></html>`;
    await this.sendMail({
      to: email,
      subject: EMAIL_CHANGE_NOTICE_SUBJECT,
      html,
      text,
    });
  }

  /**
   * Send a password reset code email to a user.
   * Values that come from user input are escaped before they reach the HTML.
   * @param email - Recipient email address
   * @param code - 6-digit password reset code
   * @param name - Recipient's name
   */
  async sendPasswordResetCode(
    email: string,
    code: string,
    name: string,
  ): Promise<void> {
    const safeName = escapeHtml(name);
    const safeCode = escapeHtml(code);
    const expiresInMinutes = this.codeExpiresInMinutes();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Reset Your Password</h2>
            <p>Hi ${safeName},</p>
            <p>You requested to reset your password. Please use the following 6-digit code to reset your password:</p>
            <div style="background-color: #f5f5f5; padding: 20px; text-align: center; border-radius: 5px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #dc3545;">${safeCode}</span>
            </div>
            <p>${codeExpirySentence(expiresInMinutes)}</p>
            <p>If you didn't request this code, you can safely ignore this email. Your password will remain unchanged.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        </body>
      </html>
    `;

    const text = `Hi ${name},\n\nYou requested to reset your password. Please use the following 6-digit code to reset your password:\n\n${code}\n\n${codeExpirySentence(expiresInMinutes)}\n\nIf you didn't request this code, you can safely ignore this email. Your password will remain unchanged.\n\nBest regards,\nThe Team`;

    await this.sendMail({
      to: email,
      subject: PASSWORD_RESET_EMAIL_SUBJECT,
      html,
      text,
    });
  }

  /**
   * Send a one-time sign-in link.
   * The link is escaped before it reaches the HTML, in the text of the anchor
   * and in its href.
   * @param email - Recipient email address
   * @param link - Client URL carrying the one-time token
   * @param expiresInMinutes - Minutes until the link stops working
   */
  async sendMagicLink(
    email: string,
    link: string,
    expiresInMinutes: number,
  ): Promise<void> {
    const safeLink = escapeHtml(link);
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your Sign-In Link</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Your Sign-In Link</h2>
            <p>Use this link to sign in. It works once.</p>
            <div style="margin: 20px 0;">
              <a href="${safeLink}" style="background-color: #007bff; color: #ffffff; padding: 12px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Sign in</a>
            </div>
            <p>If the button does not work, paste this address into your browser:</p>
            <p style="word-break: break-all; color: #555;">${safeLink}</p>
            <p>${magicLinkExpirySentence(expiresInMinutes)}</p>
            <p>If you did not request this, ignore this email.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        </body>
      </html>
    `;

    const text = `Use this link to sign in. It works once:\n\n${link}\n\n${magicLinkExpirySentence(expiresInMinutes)}\n\nIf you did not request this, ignore this email.\n\nBest regards,\nThe Team`;

    await this.sendMail({
      to: email,
      subject: MAGIC_LINK_EMAIL_SUBJECT,
      html,
      text,
    });
  }

  /**
   * Tell an account holder that their address was used in a registration.
   * Sent instead of an activation code, so registration answers the same way
   * for an address that has an account and one that does not.
   * Plain text only: there is nothing to click.
   * @param email - Recipient email address
   * @param name - Recipient's name
   */
  async sendRegistrationAttemptNotice(
    email: string,
    name: string,
  ): Promise<void> {
    const text = `Hi ${name},\n\nSomeone just tried to register an account with this email address. You already have an account, so nothing has changed and no new account was created.\n\nIf this was you, sign in instead. If you have forgotten your password, use the forgot password link on the sign-in page.\n\nIf it was not you, you can ignore this email.\n\nBest regards,\nThe Team`;

    await this.sendMail({
      to: email,
      subject: REGISTRATION_NOTICE_EMAIL_SUBJECT,
      text,
    });
  }
}

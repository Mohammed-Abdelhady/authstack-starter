import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';
import { partialMock } from '../common/testing/test-doubles.harness-spec';
import { runWithRequestContext } from '../common/context/request-context';
import {
  ACTIVATION_BODY_TEXT,
  ACTIVATION_EMAIL_SUBJECT,
  codeExpirySentence,
  EMAIL_CHANGE_CONFIRM_PATH,
  EMAIL_CHANGE_EMAIL_SUBJECT,
  magicLinkExpirySentence,
  MAIL_CONNECTION_TIMEOUT_MS,
  MAIL_GREETING_TIMEOUT_MS,
  MAIL_SOCKET_TIMEOUT_MS,
  minutesLabel,
  NEUTRAL_GREETING,
  PASSWORD_RESET_EMAIL_SUBJECT,
  REGISTRATION_NOTICE_EMAIL_SUBJECT,
} from './constants/mail.constants';

jest.mock('nodemailer');

interface SentMail {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

const CLIENT_URL = 'http://localhost:3000';
const CONFIRM_URL = `${CLIENT_URL}${EMAIL_CHANGE_CONFIRM_PATH}`;
const CODE_LIFETIME_MS = 600000;
/** Ten minutes, written by hand for the configured lifetime. */
const EXPECTED_MINUTES = 10;
/** Ninety seconds floors to one minute, never the two a ceil would print. */
const SHORT_LIFETIME_MS = 90000;
const SHORT_EXPECTED_MINUTES = 1;

describe('MailService', () => {
  let service: MailService;
  let sendMail: jest.Mock;
  let close: jest.Mock;

  const createTransport = jest.mocked(nodemailer.createTransport);
  const XSS_NAME = '<script>alert("xss")</script>';

  function lastMail(): SentMail {
    return sendMail.mock.calls[0][0] as SentMail;
  }

  async function buildService(
    codeExpiresIn: number,
    smtp: { from?: string; secure?: boolean; nodeEnv?: string } = {
      from: 'noreply@example.com',
    },
  ): Promise<MailService> {
    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'smtp.from') return smtp.from;
        if (key === 'smtp.secure') return smtp.secure ?? defaultValue;
        if (key === 'NODE_ENV') return smtp.nodeEnv ?? defaultValue;
        if (key === 'smtp.host') return 'smtp.example.com';
        if (key === 'smtp.port') return 587;
        if (key === 'cors.clientUrl') return CLIENT_URL;
        if (key === 'activation.codeExpiresIn') return codeExpiresIn;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    return module.get<MailService>(MailService);
  }

  beforeEach(async () => {
    sendMail = jest.fn().mockResolvedValue(undefined);
    close = jest.fn();
    createTransport.mockReturnValue(
      partialMock<ReturnType<typeof nodemailer.createTransport>>({
        sendMail,
        close,
      }),
    );
    createTransport.mockClear();

    service = await buildService(CODE_LIFETIME_MS);
  });

  describe('transport', () => {
    it('sets a per-send deadline for every SMTP phase', () => {
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionTimeout: MAIL_CONNECTION_TIMEOUT_MS,
          greetingTimeout: MAIL_GREETING_TIMEOUT_MS,
          socketTimeout: MAIL_SOCKET_TIMEOUT_MS,
        }),
      );
    });
  });

  describe('transport encryption', () => {
    it.each([
      [
        'production without implicit TLS refuses a relay that offers no STARTTLS',
        { nodeEnv: 'production', secure: false },
        { secure: false, requireTLS: true },
      ],
      [
        'production with implicit TLS is encrypted from the first byte',
        { nodeEnv: 'production', secure: true },
        { secure: true, requireTLS: false },
      ],
      [
        'production with the secure setting left out is treated as off',
        { nodeEnv: 'production' },
        { secure: false, requireTLS: true },
      ],
      [
        'development keeps a plain local mail catcher working',
        { nodeEnv: 'development', secure: false },
        { secure: false, requireTLS: false },
      ],
      [
        'test keeps a plain local mail catcher working',
        { nodeEnv: 'test', secure: false },
        { secure: false, requireTLS: false },
      ],
      [
        'an unset environment is not production',
        { secure: false },
        { secure: false, requireTLS: false },
      ],
    ])('%s', async (_label, settings, expected) => {
      createTransport.mockClear();

      await buildService(CODE_LIFETIME_MS, settings);

      expect(createTransport).toHaveBeenCalledTimes(1);
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining(expected),
      );
    });
  });

  describe('logging', () => {
    it('logs the request id, never the recipient address', async () => {
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});

      await runWithRequestContext('req-mail', () =>
        service.sendActivationCode('user@example.com', '123456'),
      );

      const logged = logSpy.mock.calls
        .map((call: unknown[]) => call.map((v) => String(v)).join(' '))
        .join('\n');
      expect(logged).toContain('requestId=req-mail');
      expect(logged).not.toContain('user@example.com');
    });
  });

  describe('lifetime wording', () => {
    it('pluralizes the unit from hand-written counts', () => {
      expect(minutesLabel(1)).toBe('1 minute');
      expect(minutesLabel(2)).toBe('2 minutes');
      expect(minutesLabel(10)).toBe('10 minutes');
    });

    it('builds the code sentence from that unit, not a copied string', () => {
      expect(codeExpirySentence(1)).toContain(minutesLabel(1));
      expect(codeExpirySentence(2)).toContain(minutesLabel(2));
      expect(codeExpirySentence(10)).toContain(minutesLabel(10));
    });

    it('builds the magic-link sentence from that unit', () => {
      expect(magicLinkExpirySentence(1)).toContain(minutesLabel(1));
      expect(magicLinkExpirySentence(2)).toContain(minutesLabel(2));
      expect(magicLinkExpirySentence(10)).toContain(minutesLabel(10));
    });

    it('renders the singular in the magic-link mail for one minute', async () => {
      await service.sendMagicLink('user@example.com', 'https://x/link', 1);

      const mail = lastMail();
      expect(mail.text).toContain(magicLinkExpirySentence(1));
      expect(mail.text).not.toContain('1 minutes');
      expect(mail.html).not.toContain('1 minutes');
    });
  });

  describe('sendActivationCode (S-10)', () => {
    it('should greet neutrally, with no name, because none is stored yet', async () => {
      await service.sendActivationCode('user@example.com', '123456');

      const mail = lastMail();
      expect(mail.html).toContain(NEUTRAL_GREETING);
      expect(mail.html).not.toContain(XSS_NAME);
      expect(mail.text).toContain(NEUTRAL_GREETING);
      expect(mail.text).toContain('123456');
    });

    it('should send a plain text alternative carrying the code', async () => {
      await service.sendActivationCode('user@example.com', '123456');

      const mail = lastMail();
      expect(mail.text).toContain('123456');
      expect(mail.text).not.toContain('&lt;');
    });

    it('should address the recipient and set the sender from config', async () => {
      await service.sendActivationCode('user@example.com', '123456');

      const mail = lastMail();
      expect(mail.to).toBe('user@example.com');
      expect(mail.from).toBe('noreply@example.com');
      expect(mail.subject).toBe(ACTIVATION_EMAIL_SUBJECT);
    });

    it('should render the configured lifetime, not a fixed fifteen minutes', async () => {
      await service.sendActivationCode('user@example.com', '123456');

      const mail = lastMail();
      expect(mail.html).toContain(codeExpirySentence(EXPECTED_MINUTES));
      expect(mail.text).toContain(codeExpirySentence(EXPECTED_MINUTES));
    });

    it('should round a part minute down so it never promises more time', async () => {
      const shortService = await buildService(SHORT_LIFETIME_MS);

      await shortService.sendActivationCode('user@example.com', '123456');

      const mail = lastMail();
      expect(mail.text).toContain(codeExpirySentence(SHORT_EXPECTED_MINUTES));
      expect(mail.text).not.toContain('2 minutes');
    });
  });

  describe('sendEmailChangeCode', () => {
    it('should name the change and link to the confirmation page, not a sign-up', async () => {
      await service.sendEmailChangeCode('user@example.com', '654321');

      const mail = lastMail();
      expect(mail.to).toBe('user@example.com');
      expect(mail.subject).toBe(EMAIL_CHANGE_EMAIL_SUBJECT);
      expect(mail.text).toContain(CONFIRM_URL);
      expect(mail.html).toContain(`href="${CONFIRM_URL}"`);
      expect(mail.text).toContain('654321');
      expect(mail.text).not.toContain(ACTIVATION_BODY_TEXT);
    });

    it('should carry no caller address or query string in the link', async () => {
      await service.sendEmailChangeCode('user@example.com', '654321');

      const mail = lastMail();
      expect(mail.html).not.toContain('user@example.com');
      expect(mail.html).not.toContain(`${EMAIL_CHANGE_CONFIRM_PATH}?`);
    });

    it('should render the configured lifetime', async () => {
      await service.sendEmailChangeCode('user@example.com', '654321');

      const mail = lastMail();
      expect(mail.text).toContain(codeExpirySentence(EXPECTED_MINUTES));
    });
  });

  describe('sendPasswordResetCode (S-10)', () => {
    it('should escape the name before it reaches the HTML body', async () => {
      await service.sendPasswordResetCode(
        'user@example.com',
        '654321',
        XSS_NAME,
      );

      const mail = lastMail();
      expect(mail.html).toContain('&lt;script&gt;');
      expect(mail.html).not.toContain('<script>');
    });

    it('should send a plain text alternative', async () => {
      await service.sendPasswordResetCode('user@example.com', '654321', 'Jane');

      const mail = lastMail();
      expect(mail.text).toContain('654321');
      expect(mail.subject).toBe(PASSWORD_RESET_EMAIL_SUBJECT);
    });

    it('should render the configured lifetime', async () => {
      await service.sendPasswordResetCode('user@example.com', '654321', 'Jane');

      const mail = lastMail();
      expect(mail.text).toContain(codeExpirySentence(EXPECTED_MINUTES));
    });
  });

  describe('sendRegistrationAttemptNotice (S-13)', () => {
    it('should send text only, with no HTML body and no code', async () => {
      await service.sendRegistrationAttemptNotice('user@example.com', 'Jane');

      const mail = lastMail();
      expect(mail.html).toBeUndefined();
      expect(mail.text).toContain('Hi Jane,');
      expect(mail.text).toContain('nothing has changed');
      expect(mail.subject).toBe(REGISTRATION_NOTICE_EMAIL_SUBJECT);
    });
  });

  describe('closeTransport', () => {
    it('should close the pooled transporter', () => {
      service.closeTransport();

      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendMail', () => {
    it('should report a delivery failure as an error', async () => {
      sendMail.mockRejectedValue(new Error('connection refused'));

      await expect(
        service.sendActivationCode('user@example.com', '123456'),
      ).rejects.toThrow('Failed to send email: connection refused');
    });

    it('names the setting that holds the sender when none is configured, and sends nothing', async () => {
      const unconfigured = await buildService(CODE_LIFETIME_MS, {});

      const refusal: unknown = await unconfigured
        .sendMail({ to: 'user@example.com', subject: 'subject', text: 'text' })
        .catch((error: unknown) => error);

      const message = refusal instanceof Error ? refusal.message : '';
      expect(message).toContain('EMAIL_FROM');
      expect(message).not.toContain('SMTP_FROM');
      expect(sendMail).not.toHaveBeenCalled();
    });
  });
});

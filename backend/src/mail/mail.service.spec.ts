import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { runWithRequestContext } from '../common/context/request-context';
import {
  MAIL_CONNECTION_TIMEOUT_MS,
  MAIL_GREETING_TIMEOUT_MS,
  MAIL_SOCKET_TIMEOUT_MS,
} from './constants/mail.constants';
import { mailHarness } from './mail-service.harness-spec';

jest.mock('nodemailer');

const ENGLISH = { email: 'user@example.com', locale: 'en' } as const;

/** What a transport case configures; a setting left out is unset. */
interface TransportSettings {
  NODE_ENV?: string;
  secure?: boolean;
}

interface TransportExpectation {
  secure: boolean;
  requireTLS: boolean;
}

type TransportCase = [string, TransportSettings, TransportExpectation];

describe('MailService transport', () => {
  const createTransport = jest.mocked(nodemailer.createTransport);

  beforeEach(() => {
    createTransport.mockClear();
  });

  it('sets a per-send deadline for every SMTP phase', () => {
    mailHarness();

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: MAIL_CONNECTION_TIMEOUT_MS,
        greetingTimeout: MAIL_GREETING_TIMEOUT_MS,
        socketTimeout: MAIL_SOCKET_TIMEOUT_MS,
      }),
    );
  });

  it.each<TransportCase>([
    [
      'production without implicit TLS refuses a relay that offers no STARTTLS',
      { NODE_ENV: 'production', secure: false },
      { secure: false, requireTLS: true },
    ],
    [
      'production with implicit TLS is encrypted from the first byte',
      { NODE_ENV: 'production', secure: true },
      { secure: true, requireTLS: false },
    ],
    [
      'production with the secure setting left out is treated as off',
      { NODE_ENV: 'production' },
      { secure: false, requireTLS: true },
    ],
    [
      'development keeps a plain local mail catcher working',
      { NODE_ENV: 'development', secure: false },
      { secure: false, requireTLS: false },
    ],
    [
      'test keeps a plain local mail catcher working',
      { NODE_ENV: 'test', secure: false },
      { secure: false, requireTLS: false },
    ],
    [
      'an unset environment is not production',
      { secure: false },
      { secure: false, requireTLS: false },
    ],
  ])('%s', (_label, settings, expected) => {
    const { NODE_ENV, secure } = settings;
    mailHarness({
      NODE_ENV,
      smtp: { from: 'noreply@example.com', secure },
    });

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining(expected),
    );
  });
});

describe('MailService sending', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('addresses the recipient and sets the sender from config', async () => {
    const { service, lastMail } = mailHarness();

    await service.sendActivationCode(ENGLISH, '123456');

    expect({ to: lastMail().to, from: lastMail().from }).toEqual({
      to: 'user@example.com',
      from: 'noreply@example.com',
    });
  });

  it('logs the request id, never the recipient address', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const { service } = mailHarness();

    await runWithRequestContext('req-mail', () =>
      service.sendActivationCode(ENGLISH, '123456'),
    );

    const logged = logSpy.mock.calls
      .map((call: unknown[]) => call.map((v) => String(v)).join(' '))
      .join('\n');
    expect(logged).toContain('requestId=req-mail');
    expect(logged).not.toContain('user@example.com');
  });

  it('reports a delivery failure as an error', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { service, sendMail } = mailHarness();
    sendMail.mockRejectedValue(new Error('connection refused'));

    await expect(service.sendActivationCode(ENGLISH, '123456')).rejects.toThrow(
      'Failed to send email: connection refused',
    );
  });

  it('names the setting that holds the sender when none is configured, and sends nothing', async () => {
    const { service, sendMail } = mailHarness({ smtp: {} });

    const refusal: unknown = await service
      .sendMail({ to: 'user@example.com', subject: 'subject', text: 'text' })
      .catch((error: unknown) => error);

    const message = refusal instanceof Error ? refusal.message : '';
    expect(message).toContain('EMAIL_FROM');
    expect(message).not.toContain('SMTP_FROM');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('closes the pooled transporter', () => {
    const { service, close } = mailHarness();

    service.closeTransport();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

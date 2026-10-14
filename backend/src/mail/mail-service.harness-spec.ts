import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { partialMock } from '../common/testing/test-doubles.harness-spec';
import { MailService } from './mail.service';

/** What the service handed nodemailer for one mail. */
export interface SentMail {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export const MAIL_CLIENT_URL = 'http://localhost:3000';
/** Ten minutes, the code lifetime every harness starts with. */
export const TEN_MINUTES_MS = 600000;

export interface MailHarness {
  service: MailService;
  sendMail: jest.Mock;
  close: jest.Mock;
  lastMail: () => SentMail;
}

function sentMailOf(value: unknown): SentMail {
  if (typeof value !== 'object' || value === null) {
    throw new Error('no mail was handed to the transport');
  }
  const text = (name: string): string | undefined => {
    const field: unknown = Reflect.get(value, name);
    return typeof field === 'string' ? field : undefined;
  };
  return {
    from: text('from') ?? '',
    to: text('to') ?? '',
    subject: text('subject') ?? '',
    html: text('html'),
    text: text('text'),
  };
}

/**
 * A real service over a real ConfigService, with nodemailer's transport
 * replaced. The calling spec must `jest.mock('nodemailer')`.
 */
export function mailHarness(config: Record<string, unknown> = {}): MailHarness {
  const sendMail = jest.fn().mockResolvedValue(undefined);
  const close = jest.fn();
  const createTransport = jest.mocked(nodemailer.createTransport);
  createTransport.mockReturnValue(
    partialMock<ReturnType<typeof nodemailer.createTransport>>({
      sendMail,
      close,
    }),
  );
  const service = new MailService(
    new ConfigService({
      smtp: { from: 'noreply@example.com', host: 'smtp.example.com' },
      cors: { clientUrl: MAIL_CLIENT_URL },
      activation: { codeExpiresIn: TEN_MINUTES_MS },
      ...config,
    }),
  );
  return {
    service,
    sendMail,
    close,
    lastMail: () => sentMailOf(sendMail.mock.calls.at(-1)?.[0]),
  };
}

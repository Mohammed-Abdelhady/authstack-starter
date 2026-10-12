import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { MailDispatcherService } from '../../src/mail/mail-dispatcher.service';
import { MailService } from '../../src/mail/mail.service';
import { SecurityNoticeService } from '../../src/user/services/security-notice.service';

const MAIL_CONFIG = new ConfigService({
  smtp: {
    from: 'security-notice@example.test',
  },
  mail: {
    maxPendingSends: 4,
    drainDeadlineMs: 250,
  },
});

export function securityNoticeProviders(
  config: ConfigService = MAIL_CONFIG,
): Provider[] {
  return [
    { provide: ConfigService, useValue: config },
    MailService,
    MailDispatcherService,
    SecurityNoticeService,
  ];
}

/** Keep the real mail and notice services on nodemailer's in-memory boundary. */
export function stubSmtpBoundary(): () => void {
  const transportFactory = nodemailer.createTransport.bind(nodemailer);
  const transportSpy = jest
    .spyOn(nodemailer, 'createTransport')
    .mockImplementation(() => transportFactory({ jsonTransport: true }));

  return () => transportSpy.mockRestore();
}

export async function closeSecurityNoticeFixture(
  module: TestingModule | undefined,
  restoreSmtp: (() => void) | undefined,
): Promise<void> {
  try {
    if (module) {
      await module.get(MailDispatcherService).flush();
      await module.close();
    }
  } finally {
    restoreSmtp?.();
  }
}

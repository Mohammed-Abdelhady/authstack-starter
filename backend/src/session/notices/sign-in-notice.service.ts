import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import { parseUserAgent } from '../../common/utils/parse-user-agent';
import { MailDispatcherService } from '../../mail/mail-dispatcher.service';
import { MailService } from '../../mail/mail.service';
import { buildSecurityNoticeMail } from '../../mail/builders/security-notice';
import { SECURITY_NOTICE } from '../../user/constants/security-notice.constants';
import { hashToken } from '../utils/hashing/token-hash';
import { DeviceNoticeStore } from './device-notice.store';
import { rememberDevice } from './device-notice-state';

@Injectable()
export class SignInNoticeService {
  constructor(
    private readonly store: DeviceNoticeStore,
    private readonly mail: MailService,
    private readonly dispatcher: MailDispatcherService,
  ) {}

  async record(
    work: UnitOfWork,
    input: {
      userId: string;
      userAgent: string;
      installId?: string;
      native?: boolean;
      at: Date;
      authenticatedAt?: Date;
    },
  ): Promise<void> {
    if (input.native && !input.installId) return;
    const device = parseUserAgent(input.userAgent);
    const identity = input.native
      ? `native:${input.installId}`
      : `browser:${device.parts.browserName ?? 'unknown'}:${device.parts.platformName ?? 'unknown'}`;
    const account = await this.store.take(work, input.userId);
    if (!account) return;
    const { devices, notify } = rememberDevice({
      devices: account.devices,
      key: hashToken(identity),
      at: input.at,
      signIns: account.signIns,
      authenticatedAt: input.authenticatedAt,
    });
    await this.store.save(work, input.userId, devices);
    if (!notify || !account.verified) return;
    const content = buildSecurityNoticeMail(
      account.locale,
      SECURITY_NOTICE.NEW_DEVICE,
      {
        at: input.at,
        device: device.parts,
      },
    );
    const message = { to: account.email, ...content };
    work.afterCommit(() => {
      this.dispatcher.dispatch(async () => {
        await this.mail.sendMail(message);
      }, 'New-device notice failed');
    });
  }
}

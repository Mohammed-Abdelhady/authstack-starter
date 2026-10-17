import type { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../../../../src/mail/mail.service';
import { MailDispatcherService } from '../../../../src/mail/mail-dispatcher.service';
import type { MailOptions } from '../../../../src/mail/interfaces/mail-options.interface';
import { SignInNoticeService } from '../../../../src/session/notices/sign-in-notice.service';
import { WEB_CLIENT_ID } from '../../../../src/session/constants/client-ids';
import type { IssuanceContractHarness } from './issuance-contract-harness';
import { holdReruns, rerunAtOnce } from './issuance-contract-support';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36';
const FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';

function services(
  h: IssuanceContractHarness,
  failDelivery = false,
  pause: RerunPause = rerunAtOnce,
) {
  const sent: MailOptions[] = [];
  const config = new ConfigService({ smtp: { from: 'contract@example.test' } });
  const mail = new MailService(config);
  mail.sendMail = (message) => {
    sent.push(message);
    return failDelivery
      ? Promise.reject(new Error('SMTP unavailable'))
      : Promise.resolve();
  };
  const dispatcher = new MailDispatcherService(config, mail);
  const notices = new SignInNoticeService(h.devices, mail, dispatcher);
  const service = h.service(pause, notices);
  return { sent, service, dispatcher };
}

export function issuanceDeviceNoticeCases(
  current: () => IssuanceContractHarness,
): void {
  it('keeps a committed sign-in when its new-device mail fails', async () => {
    const h = current();
    const userId = await h.seedAccount();
    await h.setNoticeRecipient(userId, 'owner@example.test');
    const { sent, service, dispatcher } = services(h, true);
    await service.createBrowserSession(
      userId,
      CHROME,
      '127.0.0.1',
      WEB_CLIENT_ID,
    );
    const issued = await service.createBrowserSession(
      userId,
      FIREFOX,
      '127.0.0.1',
      WEB_CLIENT_ID,
    );
    await dispatcher.flush();
    expect(issued.sessionToken).toEqual(expect.any(String));
    expect(await h.sessions(userId)).toHaveLength(2);
    expect(sent.map((message) => message.to)).toEqual(['owner@example.test']);
  });

  it('commits one remembered new device and one fixed-recipient notice for concurrent issues', async () => {
    const h = current();
    const userId = await h.seedAccount();
    await h.setNoticeRecipient(userId, 'original@example.test');
    const held = holdReruns();
    const { sent, service, dispatcher } = services(h, false, held.pause);
    await service.createBrowserSession(
      userId,
      CHROME,
      '127.0.0.1',
      WEB_CLIENT_ID,
    );
    await dispatcher.flush();
    expect(sent).toEqual([]);
    const issues = [
      service.createBrowserSession(userId, FIREFOX, '127.0.0.1', WEB_CLIENT_ID),
      service.createBrowserSession(userId, FIREFOX, '127.0.0.1', WEB_CLIENT_ID),
    ];
    try {
      await Promise.race(issues);
      held.refused.release();
      await Promise.all(issues);
    } finally {
      held.refused.release();
      await Promise.allSettled(issues);
    }
    expect(await h.sessions(userId)).toHaveLength(3);
    await h.setNoticeRecipient(userId, 'later@example.test');
    await dispatcher.flush();
    expect(sent.map((message) => message.to)).toEqual([
      'original@example.test',
    ]);
    const state = await h
      .runner(rerunAtOnce)
      .run((work) => h.devices.take(work, userId));
    expect({
      remembered: state?.devices?.keys.length,
      count: state?.devices?.count,
    }).toEqual({ remembered: 2, count: 1 });
  });

  it('rolls back remembered devices and never sends a notice for an aborted issuance', async () => {
    const h = current();
    const userId = await h.seedAccount();
    await h.setNoticeRecipient(userId, 'owner@example.test');
    const { sent, service, dispatcher } = services(h);
    await service.createBrowserSession(
      userId,
      CHROME,
      '127.0.0.1',
      WEB_CLIENT_ID,
    );
    const abort = new Error('refuse the transaction');
    await expect(
      h.runner(rerunAtOnce).run(async (work) => {
        await service.createBrowserSessionIn(
          work,
          userId,
          FIREFOX,
          '127.0.0.1',
          WEB_CLIENT_ID,
          { authenticationMethods: ['pwd'], userVerified: false },
        );
        throw abort;
      }),
    ).rejects.toBe(abort);
    await dispatcher.flush();
    expect(sent).toEqual([]);
    expect(await h.sessions(userId)).toHaveLength(1);
    const state = await h
      .runner(rerunAtOnce)
      .run((work) => h.devices.take(work, userId));
    expect({
      remembered: state?.devices?.keys.length,
      count: state?.devices?.count,
    }).toEqual({ remembered: 1, count: 0 });
    await service.createBrowserSession(
      userId,
      FIREFOX,
      '127.0.0.1',
      WEB_CLIENT_ID,
    );
    await dispatcher.flush();
    expect(sent.map((message) => message.to)).toEqual(['owner@example.test']);
  });
}

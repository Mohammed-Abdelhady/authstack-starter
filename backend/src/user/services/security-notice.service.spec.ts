import { ConfigService } from '@nestjs/config';
import { runWithRequestContext } from '../../common/context/request-context';
import { partialMock } from '../../common/testing/test-doubles.harness-spec';
import { MAIL_CATALOGUES } from '../../mail/catalog/mail-catalogue';
import { MailDispatcherService } from '../../mail/mail-dispatcher.service';
import { mailHarness, MailHarness } from '../../mail/mail-service.harness-spec';
import { FrozenClock, TEST_NOW } from '../../../test/utils/frozen-clock';
import { SECURITY_NOTICE } from '../constants/security-notice.constants';
import { AccountProfileStore } from '../stores/account-profile.store';
import { StoredAccount } from '../stores/stored-account';
import { SecurityNoticeService } from './security-notice.service';

jest.mock('nodemailer');

const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

/** The account as a read would find it once it has moved and been deactivated. */
const NOW_ELSEWHERE = partialMock<StoredAccount>({
  id: 'account-1',
  email: 'new@example.test',
  locale: 'en',
  isVerified: true,
  isDeleted: true,
});

describe('SecurityNoticeService', () => {
  let mail: MailHarness;
  let dispatcher: MailDispatcherService;
  let notices: SecurityNoticeService;

  beforeEach(() => {
    mail = mailHarness();
    dispatcher = new MailDispatcherService(new ConfigService({}), mail.service);
    notices = new SecurityNoticeService(
      partialMock<AccountProfileStore>({
        findProfile: () => Promise.resolve(NOW_ELSEWHERE),
      }),
      mail.service,
      dispatcher,
      new FrozenClock(TEST_NOW),
    );
  });

  it('mails the recipient fixed at commit, though the account has moved and is deactivated since', async () => {
    notices.deferTo(
      { email: 'old@example.test', locale: 'en' },
      SECURITY_NOTICE.EMAIL_CHANGED,
    );
    await dispatcher.flush();

    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(mail.lastMail()).toMatchObject({
      to: 'old@example.test',
      subject: MAIL_CATALOGUES.en.securityNotice.emailChangedSubject,
    });
  });

  it('still skips a deactivated account for a notice that reads the address when it is sent', async () => {
    notices.defer('account-1', SECURITY_NOTICE.PASSKEY_REMOVED);
    await dispatcher.flush();

    expect(mail.sendMail).not.toHaveBeenCalled();
  });

  it('names the device of the request that made the change, taken while it is handled', async () => {
    runWithRequestContext(
      'request-1',
      () =>
        notices.deferTo(
          { email: 'old@example.test', locale: 'en' },
          SECURITY_NOTICE.EMAIL_CHANGED,
        ),
      CHROME_ON_MAC,
    );
    await dispatcher.flush();

    const text = mail.lastMail().text ?? '';
    expect(text).toContain('Chrome');
    expect(text).toContain('macOS');
    expect(text).toContain('2099');
  });
});

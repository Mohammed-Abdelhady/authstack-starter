import { SUPPORTED_LOCALES } from '../../common/constants/locales';
import { DEVICE_KIND } from '../../common/constants/session';
import { SECURITY_NOTICE } from '../../user/constants/security-notice.constants';
import type { SecurityNotice } from '../../user/types/security-notice.type';
import { buildSecurityNoticeMail } from './security-notice';

const AT = new Date('2099-03-04T05:06:00.000Z');
const SAFARI_ON_IOS = {
  kind: DEVICE_KIND.BROWSER,
  browserName: 'Safari',
  platformName: 'iOS',
};
/** Any six digits in a row, the shape of every code the server mails. */
const CODE_SHAPE = /\b\d{6}\b/;

describe('security notice facts', () => {
  it.each(SUPPORTED_LOCALES)(
    'writes the time in Western digits and in UTC, in %s',
    (locale) => {
      const mail = buildSecurityNoticeMail(locale, SECURITY_NOTICE.NEW_DEVICE, {
        at: AT,
        device: SAFARI_ON_IOS,
      });

      expect(mail.text).toContain('2099');
      expect(mail.text).toContain('05:06');
      expect(mail.text).toContain('UTC');
      expect(mail.text).not.toMatch(/[٠-٩]/);
      expect(mail.text).toContain('Safari');
      expect(mail.text).toContain('iOS');
    },
  );

  it.each([
    SECURITY_NOTICE.ACCOUNT_DEACTIVATED,
    SECURITY_NOTICE.ACCOUNT_RESTORED,
    SECURITY_NOTICE.PASSKEYS_RESET,
  ])('names no device on the %s notice, which staff caused', (notice) => {
    const mail = buildSecurityNoticeMail('en', notice, {
      at: AT,
      device: SAFARI_ON_IOS,
    });

    expect(mail.text).toContain('2099');
    expect(mail.text).not.toContain('Safari');
  });

  it.each(Object.values(SECURITY_NOTICE))(
    'carries no link and no code in the %s notice, in every language',
    (notice: SecurityNotice) => {
      for (const locale of SUPPORTED_LOCALES) {
        const mail = buildSecurityNoticeMail(locale, notice, {
          at: AT,
          device: SAFARI_ON_IOS,
        });
        const body = `${mail.text}\n${mail.html ?? ''}`;

        expect(body).not.toMatch(/https?:\/\//);
        expect(body).not.toMatch(/<a\s/);
        expect(mail.text).not.toMatch(CODE_SHAPE);
      }
    },
  );
});

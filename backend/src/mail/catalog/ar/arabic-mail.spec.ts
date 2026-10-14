import { ConfigService } from '@nestjs/config';
import {
  chosenLocale,
  requestLocale,
  storedLocale,
} from '../../../common/constants/locales';
import { SECURITY_NOTICE } from '../../../user/constants/security-notice.constants';
import type { SecurityNotice } from '../../../user/types/security-notice.type';
import { minutesPhrase } from '../../builders/mail-layout';
import { MAIL_NAME } from '../../constants/mail-names';
import { parseMailLinkTemplates } from '../../links/mail-link-templates';
import { mailLink } from '../../links/mail-links';
import { mailHarness, MailHarness } from '../../mail-service.harness-spec';
import { MAIL_CATALOGUES } from '../mail-catalogue';

jest.mock('nodemailer');

const ARABIC = { email: 'user@example.test', locale: 'ar' } as const;
const RTL_ROOT = '<!DOCTYPE html>\n<html lang="ar" dir="rtl">';
const RTL_BLOCK = '<div lang="ar" dir="rtl"';

/** Each notice's Arabic subject, written out by hand. */
const NOTICE_SUBJECTS: Readonly<Record<SecurityNotice, string>> = {
  [SECURITY_NOTICE.PASSWORD_RESET]: 'أُعيد تعيين كلمة المرور',
  [SECURITY_NOTICE.PASSWORD_CHANGED]: 'تغيّرت كلمة المرور',
  [SECURITY_NOTICE.TWO_FACTOR_DISABLED]: 'أُوقف التحقق بخطوتين',
  [SECURITY_NOTICE.PASSKEY_ADDED]: 'أُضيف مفتاح مرور',
  [SECURITY_NOTICE.PROVIDER_ADDED]: 'أُضيف مزوّد لتسجيل الدخول',
};

describe('Arabic mail', () => {
  const copy = MAIL_CATALOGUES.ar;
  let harness: MailHarness;

  beforeEach(() => {
    harness = mailHarness();
  });

  it.each([
    {
      mail: 'activation code',
      subject: copy.activationCode.subject,
      send: () => harness.service.sendActivationCode(ARABIC, '123456'),
    },
    {
      mail: 'email change code',
      subject: copy.emailChangeCode.subject,
      send: () => harness.service.sendEmailChangeCode(ARABIC, '123456'),
    },
    {
      mail: 'email change notice',
      subject: copy.emailChangeNotice.subject,
      send: () => harness.service.sendEmailChangeNotice(ARABIC),
    },
    {
      mail: 'password reset code',
      subject: copy.passwordResetCode.subject,
      send: () =>
        harness.service.sendPasswordResetCode(ARABIC, '123456', 'ليلى'),
    },
    {
      mail: 'sign-in link',
      subject: copy.magicLink.subject,
      send: () =>
        harness.service.sendMagicLink(ARABIC, 'https://id.example.test', 15),
    },
    {
      mail: 'registration notice',
      subject: copy.registrationNotice.subject,
      send: () => harness.service.sendRegistrationAttemptNotice(ARABIC, 'ليلى'),
    },
    ...Object.values(SECURITY_NOTICE).map((notice) => ({
      mail: `${notice} security notice`,
      subject: NOTICE_SUBJECTS[notice],
      send: () => harness.service.sendSecurityNotice(ARABIC, notice),
    })),
  ])('writes the $mail right to left, in Arabic', async ({ subject, send }) => {
    await send();

    const sent = harness.lastMail();
    expect({
      subject: sent.subject,
      root: sent.html?.startsWith(RTL_ROOT),
      block: sent.html?.includes(RTL_BLOCK),
    }).toEqual({ subject, root: true, block: true });
  });

  it('writes the code lifetime with the Arabic plural', async () => {
    await harness.service.sendActivationCode(ARABIC, '123456');

    expect(harness.lastMail().text?.split('\n\n')).toEqual([
      'مرحبًا،',
      'شكرًا لتسجيلك! يُرجى استخدام رمز التحقق التالي المكوّن من 6 أرقام لإكمال تسجيلك:',
      '123456',
      'تنتهي صلاحية هذا الرمز خلال 10 دقائق.',
      'إذا لم تطلب هذا الرمز، فيمكنك تجاهل هذه الرسالة بأمان.',
      'مع خالص التحية،\nالفريق',
    ]);
  });

  it.each([
    { minutes: 0, phrase: '0 دقيقة' },
    { minutes: 1, phrase: 'دقيقة واحدة' },
    { minutes: 2, phrase: 'دقيقتين' },
    { minutes: 3, phrase: '3 دقائق' },
    { minutes: 10, phrase: '10 دقائق' },
    { minutes: 11, phrase: '11 دقيقة' },
    { minutes: 100, phrase: '100 دقيقة' },
  ])('counts $minutes minutes as "$phrase"', ({ minutes, phrase }) => {
    expect(minutesPhrase('ar', minutes)).toBe(phrase);
  });

  it('fills {locale} in a link template with ar', () => {
    const config = new ConfigService({
      mail: {
        links: {
          customer: parseMailLinkTemplates(
            JSON.stringify({
              emailChangeCode: 'https://console.example.test/{locale}',
              magicLink: 'https://id.example.test/{locale}/link',
            }),
            'MAIL_LINKS_CUSTOMER',
          ),
        },
      },
    });

    const link = mailLink(config, MAIL_NAME.MAGIC_LINK, ARABIC, { token: 't' });

    expect(link).toBe('https://id.example.test/ar/link?token=t');
  });
});

describe('the language of a request and of a record', () => {
  it.each([
    {
      label: 'the body before the header',
      body: 'ar',
      header: 'en',
      expected: 'ar',
    },
    {
      label: 'an English body over an Arabic header',
      body: 'en',
      header: 'ar',
      expected: 'en',
    },
    {
      label: 'a regional header tag',
      body: undefined,
      header: 'ar-EG, en;q=0.8',
      expected: 'ar',
    },
    {
      label: 'the header past an unsupported body',
      body: 'fr',
      header: 'ar',
      expected: 'ar',
    },
    {
      label: 'a weighted header',
      body: undefined,
      header: 'en;q=0.4, ar;q=0.9',
      expected: 'ar',
    },
  ])('takes $label', ({ body, header, expected }) => {
    expect(requestLocale(body, header)).toBe(expected);
  });

  it.each([
    { label: 'an Arabic body', body: 'ar', expected: 'ar' },
    { label: 'a regional Arabic body', body: 'ar-SA', expected: 'ar' },
    { label: 'no body language', body: undefined, expected: 'en' },
    { label: 'an unsupported body language', body: 'fr', expected: 'en' },
  ])('gives an account made for someone else $label', ({ body, expected }) => {
    expect(chosenLocale(body)).toBe(expected);
  });

  it('reads a stored Arabic account as Arabic', () => {
    expect(storedLocale('ar')).toBe('ar');
  });
});

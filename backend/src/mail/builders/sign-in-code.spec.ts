import { formatMessage } from '../catalog/format-message';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import { buildSignInCodeMail } from './sign-in-code';

const LINK =
  'myapp://callback#native_attempt_id=attempt-1&native_email_token=token-1&state=state-1';

describe('sign-in code mail', () => {
  it('carries the code in the subject and body, and the button only with a link', () => {
    const withLink = buildSignInCodeMail({
      locale: 'en',
      code: '042137',
      expiresInMinutes: 10,
      link: LINK,
    });
    const withoutLink = buildSignInCodeMail({
      locale: 'en',
      code: '042137',
      expiresInMinutes: 10,
      link: null,
    });
    const copy = MAIL_CATALOGUES.en.signInCode;

    expect(withLink.subject).toBe(
      formatMessage(copy.subject, { code: '042137' }),
    );
    expect(withLink.text).toContain('042137');
    expect(withLink.text).toContain(LINK);
    expect(withLink.html).toContain(copy.button);
    expect(withoutLink.text).toContain('042137');
    expect(withoutLink.text).not.toContain('myapp://');
    expect(withoutLink.html).not.toContain(copy.button);
    expect(withoutLink.html).not.toContain('myapp://');
  });

  it('keeps Western digits in an Arabic mail', () => {
    const mail = buildSignInCodeMail({
      locale: 'ar',
      code: '042137',
      expiresInMinutes: 10,
      link: null,
    });

    expect(mail.subject).toBe(
      formatMessage(MAIL_CATALOGUES.ar.signInCode.subject, { code: '042137' }),
    );
    expect(mail.text).toContain('042137');
    expect(mail.text).not.toMatch(/[٠-٩]/u);
  });
});

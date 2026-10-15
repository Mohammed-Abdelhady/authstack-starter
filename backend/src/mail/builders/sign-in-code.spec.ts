import { Logger } from '@nestjs/common';
import { runWithRequestContext } from '../../common/context/request-context';
import { SUPPORTED_LOCALES } from '../../common/constants/locales';
import { MAIL_CATALOGUES } from '../catalog/mail-catalogue';
import { mailHarness } from '../mail-service.harness-spec';
import { buildSignInCodeMail } from './sign-in-code';

jest.mock('nodemailer');

const LINK =
  'myapp://callback#native_attempt_id=attempt-1&native_email_token=token-1&state=state-1';
const CODE = '042137';
const REQUEST_ID = 'req-sign-in-code';

/** Everything the Nest logger is handed at the levels the mail service writes. */
function captureLogLines(): () => string {
  const spies = [
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  ];
  return () =>
    spies
      .flatMap((spy) => spy.mock.calls)
      .map((call: unknown[]) => call.map((part) => String(part)).join(' '))
      .join('\n');
}

describe('sign-in code mail', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('carries the code in the body, and the button only with a link', () => {
    const withLink = buildSignInCodeMail({
      locale: 'en',
      code: CODE,
      expiresInMinutes: 10,
      link: LINK,
    });
    const withoutLink = buildSignInCodeMail({
      locale: 'en',
      code: CODE,
      expiresInMinutes: 10,
      link: null,
    });
    const copy = MAIL_CATALOGUES.en.signInCode;

    expect(withLink.text).toContain(CODE);
    expect(withLink.text).toContain(LINK);
    expect(withLink.html).toContain(copy.button);
    expect(withoutLink.text).toContain(CODE);
    expect(withoutLink.text).not.toContain('myapp://');
    expect(withoutLink.html).not.toContain(copy.button);
    expect(withoutLink.html).not.toContain('myapp://');
  });

  it('keeps the code out of every line the mail service logs, sent or failed', async () => {
    const logged = captureLogLines();
    const { service, sendMail, lastMail } = mailHarness();

    await runWithRequestContext(REQUEST_ID, async () => {
      for (const locale of SUPPORTED_LOCALES) {
        const mail = buildSignInCodeMail({
          locale,
          code: CODE,
          expiresInMinutes: 10,
          link: LINK,
        });
        await service.sendMail({ to: 'person@example.test', ...mail });
        sendMail.mockRejectedValueOnce(new Error('connection refused'));
        await expect(
          service.sendMail({ to: 'person@example.test', ...mail }),
        ).rejects.toThrow('Failed to send email');
      }
    });

    expect(lastMail().text).toContain(CODE);
    expect(logged()).toContain(`requestId=${REQUEST_ID}`);
    expect(logged()).not.toContain(CODE);
  });

  // feature:locale-ar:start
  it('keeps Western digits in an Arabic mail', () => {
    const mail = buildSignInCodeMail({
      locale: 'ar',
      code: CODE,
      expiresInMinutes: 10,
      link: null,
    });

    expect(mail.text).toContain(CODE);
    expect(mail.text).not.toMatch(/[٠-٩]/u);
  });
  // feature:locale-ar:end
});

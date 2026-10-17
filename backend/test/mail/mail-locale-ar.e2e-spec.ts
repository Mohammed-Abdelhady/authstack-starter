import { ConfigService } from '@nestjs/config'; // feature:magic-link
import { MAIL_CATALOGUES } from '../../src/mail/catalog/mail-catalogue';
import type { MailOptions } from '../../src/mail/interfaces/mail-options.interface';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent, // feature:email-password,magic-link
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const ARABIC = MAIL_CATALOGUES.ar;
const ENGLISH = MAIL_CATALOGUES.en; // feature:email-password
const RTL_ROOT = '<html lang="ar" dir="rtl">';

/** Who got the mail, in which language, and whether its root reads right to left. */
function readMail(mail: MailOptions | undefined) {
  return {
    to: mail?.to,
    subject: mail?.subject,
    rightToLeft: mail?.html?.includes(RTL_ROOT) === true,
  };
}

describe('Arabic accounts and mail (e2e)', () => {
  let e2e: E2eApp;
  let admin: TestAgent;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    admin = await loginAs(e2e.httpServer, SEED_ADMIN);
  });

  async function storedLocaleOf(email: string): Promise<string | undefined> {
    return (await e2e.state.accounts.accountWithAddress(email))?.locale;
  }

  async function lastMailTo(email: string): Promise<MailOptions | undefined> {
    return (await e2e.captureMail()).filter((mail) => mail.to === email).at(-1);
  }

  // feature:email-password:start
  it("mails an Arabic account in Arabic whatever the request's language", async () => {
    await e2e.state.accounts.createAccount({
      email: 'layla@example.test',
      name: 'Layla',
      isVerified: true,
      locale: 'ar',
    });
    const browser = await browserAgent(e2e.httpServer);

    await browser
      .post('/api/auth/forgot-password')
      .set('Accept-Language', 'en')
      .send({ email: 'layla@example.test' })
      .expect(200);

    expect(readMail(await lastMailTo('layla@example.test'))).toEqual({
      to: 'layla@example.test',
      subject: ARABIC.passwordResetCode.subject,
      rightToLeft: true,
    });
  });

  it('mails an English account in English when the request asks for Arabic', async () => {
    const browser = await browserAgent(e2e.httpServer);

    await browser
      .post('/api/auth/forgot-password')
      .set('Accept-Language', 'ar')
      .send({ email: SEED_USER.email })
      .expect(200);

    expect(readMail(await lastMailTo(SEED_USER.email))).toEqual({
      to: SEED_USER.email,
      subject: ENGLISH.passwordResetCode.subject,
      rightToLeft: false,
    });
  });

  it('mails a new address in the request language, and activation stores it', async () => {
    const email = 'newcomer@example.test';
    const browser = await browserAgent(e2e.httpServer);

    await browser
      .post('/api/auth/register')
      .set('Accept-Language', 'ar-SA, en;q=0.5')
      .send({ email })
      .expect(200);
    const codeMail = readMail(await lastMailTo(email));
    const code = await e2e.mailedCode();
    // A browser proof is spent by one request, so each post takes a fresh one.
    await (
      await browserAgent(e2e.httpServer)
    )
      .post('/api/auth/activate')
      .set('Accept-Language', 'ar')
      .send({ email, code, password: 'Created123!', name: 'Newcomer' })
      .expect(200);

    expect({ codeMail, stored: await storedLocaleOf(email) }).toEqual({
      codeMail: {
        to: email,
        subject: ARABIC.activationCode.subject,
        rightToLeft: true,
      },
      stored: 'ar',
    });
  });
  it('sends a security notice to an Arabic account in Arabic', async () => {
    const user = await loginAs(e2e.httpServer, SEED_USER);
    await user.patch('/api/user/profile').send({ locale: 'ar' }).expect(200);

    await user
      .post('/api/user/password')
      .set('Accept-Language', 'en')
      .send({
        currentPassword: SEED_USER.password,
        newPassword: 'ChangedPassword123!',
      })
      .expect(200);

    expect(readMail(await lastMailTo(SEED_USER.email))).toEqual({
      to: SEED_USER.email,
      subject: ARABIC.securityNotice.passwordChangedSubject,
      rightToLeft: true,
    });
  });
  // feature:email-password:end

  it('mails both sides of an admin email change in the account language', async () => {
    const { _id } = await e2e.state.accounts.createAccount({
      email: 'moving@example.test',
      name: 'Moving',
      isVerified: true,
      locale: 'ar',
    });

    await admin
      .patch(`/api/admin/users/${_id}`)
      .set('Accept-Language', 'en')
      .send({ email: 'moved@example.test' })
      .expect(200);

    expect({
      notice: readMail(await lastMailTo('moving@example.test')),
      code: readMail(await lastMailTo('moved@example.test')),
    }).toEqual({
      notice: {
        to: 'moving@example.test',
        subject: ARABIC.emailChangeNotice.subject,
        rightToLeft: true,
      },
      code: {
        to: 'moved@example.test',
        subject: ARABIC.emailChangeCode.subject,
        rightToLeft: true,
      },
    });
  });

  // feature:magic-link:start
  it('mails a sign-in link to a new address in the request language, and the link stores it', async () => {
    e2e.app.get(ConfigService).set('magicLink.enabled', true);
    const email = 'linked@example.test';
    const browser = await browserAgent(e2e.httpServer);

    await browser
      .post('/api/auth/magic-link/request')
      .set('Accept-Language', 'ar')
      .send({ email })
      .expect(200);
    const mail = await lastMailTo(email);
    const link = mail?.text?.split('\n\n')[1] ?? '';
    const token = new URL(link).searchParams.get('token');
    await (
      await browserAgent(e2e.httpServer)
    )
      .post('/api/auth/magic-link/verify')
      .set('Accept-Language', 'ar')
      .send({ token, confirm: true })
      .expect(200);

    expect({
      mail: readMail(mail),
      stored: await storedLocaleOf(email),
    }).toEqual({
      mail: { to: email, subject: ARABIC.magicLink.subject, rightToLeft: true },
      stored: 'ar',
    });
  });
  // feature:magic-link:end
});

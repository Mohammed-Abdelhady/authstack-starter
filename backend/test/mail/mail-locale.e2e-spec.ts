import { ConfigService } from '@nestjs/config'; // feature:magic-link
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent, // feature:email-password,magic-link
  E2E_CLIENT_URL, // feature:magic-link
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const CREATED = {
  email: 'created@seed.local',
  name: 'Created User',
  password: 'Created123!',
  role: 'user',
};

interface ProfileBody {
  data: { locale: string };
}

/** The account language on either database, and the language of English mail. */
describe('account language (e2e)', () => {
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

  it('stores en for an account created with no language', async () => {
    await admin.post('/api/admin/users').send(CREATED).expect(201);

    expect(await storedLocaleOf(CREATED.email)).toBe('en');
  });

  it('stores en when the body and the header name languages it lacks', async () => {
    await admin
      .post('/api/admin/users')
      .set('Accept-Language', 'de-DE, fr;q=0.8')
      .send({ ...CREATED, locale: 'fr' })
      .expect(201);

    expect(await storedLocaleOf(CREATED.email)).toBe('en');
  });

  it('reads en for an account stored without a language', async () => {
    const user = await loginAs(e2e.httpServer, SEED_USER);

    const profile = await user.get('/api/user/profile').expect(200);

    expect({
      stored: await storedLocaleOf(SEED_USER.email),
      answered: (profile.body as ProfileBody).data.locale,
    }).toEqual({ stored: 'en', answered: 'en' });
  });

  it('refuses a profile language it lacks, and null, and keeps the stored one', async () => {
    const user = await loginAs(e2e.httpServer, SEED_USER);

    const unsupported = await user
      .patch('/api/user/profile')
      .send({ locale: 'fr' });
    const empty = await user.patch('/api/user/profile').send({ locale: null });
    const supported = await user
      .patch('/api/user/profile')
      .send({ locale: 'en' });

    expect({
      unsupported: unsupported.status,
      empty: empty.status,
      supported: supported.status,
      answered: (supported.body as ProfileBody).data.locale,
      stored: await storedLocaleOf(SEED_USER.email),
    }).toEqual({
      unsupported: 400,
      empty: 400,
      supported: 200,
      answered: 'en',
      stored: 'en',
    });
  });

  // feature:email-password:start
  it('mails a sign-up code in English when the request asks for a language it lacks', async () => {
    const browser = await browserAgent(e2e.httpServer);

    await browser
      .post('/api/auth/register')
      .set('Accept-Language', 'fr-FR')
      .send({ email: 'newcomer@example.test', locale: 'de' })
      .expect(200);

    const mail = (await e2e.captureMail()).at(-1);
    expect({ to: mail?.to, subject: mail?.subject }).toEqual({
      to: 'newcomer@example.test',
      subject: 'Verify Your Email Address',
    });
  });
  // feature:email-password:end

  // feature:magic-link:start
  it('links a sign-in mail to CLIENT_URL as before, in English', async () => {
    e2e.app.get(ConfigService).set('magicLink.enabled', true);
    const browser = await browserAgent(e2e.httpServer);

    await browser
      .post('/api/auth/magic-link/request')
      .set('Accept-Language', 'ja')
      .send({ email: 'linked@example.test' })
      .expect(200);

    const mail = (await e2e.captureMail()).at(-1);
    const link = mail?.text?.split('\n\n')[1] ?? '';
    expect({
      subject: mail?.subject,
      page: link.slice(0, link.indexOf('?')),
      query: [...new URL(link).searchParams.keys()],
    }).toEqual({
      subject: 'Your Sign-In Link',
      page: `${E2E_CLIENT_URL}/auth/magic-link/verify`,
      query: ['token'],
    });
  });
  // feature:magic-link:end
});

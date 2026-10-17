import { ConfigService } from '@nestjs/config'; // feature:magic-link
import {
  bootE2eApp,
  browserAgent, // feature:email-password,magic-link
  E2E_CLIENT_URL, // feature:magic-link
  type E2eApp,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

/** The account language on either database, and the language of English mail. */
describe('account language (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
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

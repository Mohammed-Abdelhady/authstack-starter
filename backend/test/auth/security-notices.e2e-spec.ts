import {
  SECURITY_NOTICE,
  SECURITY_NOTICE_MESSAGES,
} from '../../src/user/constants/security-notice.constants';
import request from 'supertest';
import { SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent,
  loginAs,
  type E2eApp,
} from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const NEW_PASSWORD = 'ChangedPassword123!';

describe('security notices after committed changes (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await e2e.reset();
  });

  it('sends one text notice to the verified address after a password change', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await browser
      .post('/api/user/password')
      .send({
        currentPassword: SEED_USER.password,
        newPassword: NEW_PASSWORD,
      })
      .expect(200);

    const mail = await e2e.captureMail();
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({
      to: SEED_USER.email,
      subject:
        SECURITY_NOTICE_MESSAGES[SECURITY_NOTICE.PASSWORD_CHANGED].subject,
    });
    expect(mail[0].html).toBeUndefined();
    expect(JSON.stringify(mail)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(mail)).not.toContain(SEED_USER.password);
  });

  it('sends no notice for a refused password change', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await browser
      .post('/api/user/password')
      .send({
        currentPassword: 'WrongPassword123!',
        newPassword: NEW_PASSWORD,
      })
      .expect(400);

    expect(await e2e.captureMail()).toEqual([]);
  });

  it('sends a separate notice after a successful password reset', async () => {
    const browser = await browserAgent(e2e.httpServer);
    await browser
      .post('/api/auth/forgot-password')
      .send({ email: SEED_USER.email })
      .expect(200);
    const code = await e2e.mailedCode();
    const resetBrowser = await browserAgent(e2e.httpServer);
    await resetBrowser
      .post('/api/auth/reset-password')
      .send({ email: SEED_USER.email, code, newPassword: NEW_PASSWORD })
      .expect(200);
    const mail = await e2e.captureMail();
    expect(mail).toHaveLength(2);
    expect(mail[1]).toMatchObject({
      to: SEED_USER.email,
      subject: SECURITY_NOTICE_MESSAGES[SECURITY_NOTICE.PASSWORD_RESET].subject,
    });
    expect(JSON.stringify(mail[1])).not.toContain(code);
    expect(JSON.stringify(mail[1])).not.toContain(NEW_PASSWORD);
  });

  it('does not send a notice for an anonymous profile read', async () => {
    await request(e2e.httpServer).get('/api/user/profile').expect(401);
    expect(await e2e.captureMail()).toEqual([]);
  });
});

describe('security notice delivery failure (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, { failMail: true });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('keeps the committed password change successful when SMTP refuses the notice', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    await browser
      .post('/api/user/password')
      .send({
        currentPassword: SEED_USER.password,
        newPassword: NEW_PASSWORD,
      })
      .expect(200);
    await e2e.captureMail();
    await browser.get('/api/user/profile').expect(200);
  });
});

import { browserAgent, type E2eApp } from '../utils/e2e-app';
import { SEED_USER } from '../constants/seed-users';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  askCode,
  bootBrowserCodeApp,
  nonceOf,
  storedCode,
  verifyCode,
} from './browser-code.fixtures';

describe('browser code when mail delivery fails', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootBrowserCodeApp(true);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('keeps the generic reply, retries three sends and leaves the unmailed code spent', async () => {
    const browser = await browserAgent(e2e.httpServer);
    const { answer, mail } = await askCode(e2e, browser);
    expect(answer.body).toEqual({
      success: true,
      data: { email: SEED_USER.email },
    });
    expect((await e2e.captureMail()).length).toBe(3);
    expect((await storedCode(e2e, nonceOf(answer)))?.spentAt).toEqual(
      e2e.clock.now(),
    );
    expect((await verifyCode(browser, mail.code)).status).toBe(400);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });
});

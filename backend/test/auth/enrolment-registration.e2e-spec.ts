import request from 'supertest';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import type { E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  bootEnrolmentApp,
  ENROLMENT_ORIGIN,
  issueEnrolment,
} from '../utils/session/enrolment-fixtures';

const MINUTE_MS = 60_000;
const OPTIONS = '/api/auth/passkeys/register/options';

// Failure: an expired enrolment reaches passkey registration and creates authority.
describe('enrolment registration expiry', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootEnrolmentApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('refuses fresh registration options at minute 16 without creating authority', async () => {
    const issued = await issueEnrolment(e2e);
    e2e.clock.advance(16 * MINUTE_MS);
    await request(e2e.httpServer)
      .post(OPTIONS)
      .set('Origin', ENROLMENT_ORIGIN)
      .set('Cookie', issued.cookie)
      .set(CSRF_HEADER, issued.csrfToken)
      .send({})
      .expect(401);
    expect(await e2e.state.auth.countPasskeys()).toBe(0);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
    expect(await e2e.app.get(Sessions).getUserSessions(issued.userId)).toEqual(
      [],
    );
    expect(
      await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
    ).toBeNull();
  });
});

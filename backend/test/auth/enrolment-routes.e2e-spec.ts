import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service';
import { PasskeyManagementService } from '../../src/auth/passkeys/services/passkey-management.service';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../src/session/constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../../src/session/constants/credential-purpose';
import { UserProfileService } from '../../src/user/services/user-profile.service';
import { SEED_USER } from '../constants/seed-users';
import { ADMIN_ORIGIN } from '../utils/audience-authorization.fixtures';
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

// Failure: limited authority either breaks reload/sign-out or reaches ordinary handlers.
describe('enrolment HTTP route boundary', () => {
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

  it('restores identity and CSRF from a fresh request and revokes on sign-out', async () => {
    const issued = await issueEnrolment(e2e);
    const identity = await request(e2e.httpServer)
      .get('/api/auth/identity')
      .set('Origin', ENROLMENT_ORIGIN)
      .set('Cookie', issued.cookie)
      .expect(200);
    expect(identity.body).toMatchObject({
      data: {
        authenticated: true,
        enrolment: true,
        user: { email: SEED_USER.email },
      },
    });
    const csrf = await request(e2e.httpServer)
      .get('/api/auth/csrf')
      .set('Origin', ENROLMENT_ORIGIN)
      .set('Cookie', issued.cookie)
      .expect(200);
    expect(csrf.body).toMatchObject({ data: { token: issued.csrfToken } });
    await request(e2e.httpServer)
      .get('/api/auth/browser-proof')
      .set('Origin', ENROLMENT_ORIGIN)
      .set('Cookie', issued.cookie)
      .expect(200);
    expect(
      await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
    ).toMatchObject({ credentialPurpose: CREDENTIAL_PURPOSE.ENROLMENT });
    await request(e2e.httpServer)
      .post('/api/auth/logout')
      .set('Origin', ENROLMENT_ORIGIN)
      .set('Cookie', issued.cookie)
      .set(CSRF_HEADER, issued.csrfToken)
      .expect(200);
    expect((await e2e.state.sessions.session(issued.session.id))?.isValid).toBe(
      false,
    );
    expect(
      await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
    ).toBeNull();
  });

  // Failure: renaming an enrolment cookie grants authority in another application.
  it('refuses a web enrolment replayed under the admin cookie name', async () => {
    const issued = await issueEnrolment(e2e);
    const name = e2e.app.get(SessionCookieService).nameFor(ADMIN_CLIENT_ID);
    await request(e2e.httpServer)
      .get('/api/auth/csrf')
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', `${name}=${issued.sessionToken}`)
      .expect(403);
    expect(
      await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
    ).toMatchObject({ clientId: WEB_CLIENT_ID });
  });

  it('refuses public, protected, management and wrong-method handlers before they run', async () => {
    const issued = await issueEnrolment(e2e);
    const profiles = jest.spyOn(e2e.app.get(UserProfileService), 'getProfile');
    const login = jest.spyOn(e2e.app.get(AuthService), 'login');
    const listing = jest.spyOn(e2e.app.get(PasskeyManagementService), 'list');
    const removing = jest.spyOn(
      e2e.app.get(PasskeyManagementService),
      'remove',
    );
    try {
      for (const path of [
        '/api/user/profile',
        '/api/user/sessions',
        '/api/auth/passkeys',
      ]) {
        await request(e2e.httpServer)
          .get(path)
          .set('Origin', ENROLMENT_ORIGIN)
          .set('Cookie', issued.cookie)
          .expect(403);
      }
      await request(e2e.httpServer)
        .post('/api/auth/login')
        .set('Origin', ENROLMENT_ORIGIN)
        .set('Cookie', issued.cookie)
        .set(CSRF_HEADER, issued.csrfToken)
        .send(SEED_USER)
        .expect(403);
      await request(e2e.httpServer)
        .delete(`/api/auth/passkeys/${issued.session.id}`)
        .set('Origin', ENROLMENT_ORIGIN)
        .set('Cookie', issued.cookie)
        .set(CSRF_HEADER, issued.csrfToken)
        .expect(403);
      // Express can dispatch HEAD to a GET handler; the method must still be refused.
      await request(e2e.httpServer)
        .head('/api/auth/identity')
        .set('Origin', ENROLMENT_ORIGIN)
        .set('Cookie', issued.cookie)
        .expect(403);
      expect(profiles).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
      expect(listing).not.toHaveBeenCalled();
      expect(removing).not.toHaveBeenCalled();
      expect(await e2e.state.sessions.countSessions()).toBe(1);
    } finally {
      profiles.mockRestore();
      login.mockRestore();
      listing.mockRestore();
      removing.mockRestore();
    }
  });
});
